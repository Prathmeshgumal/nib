package store

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/Prathmeshgumal/nib/internal/attach"
)

// postgresSchema mirrors the SQLite one, plus a table for attachments: the
// hosted server runs somewhere whose disk is wiped on every restart, so the
// files have to live beside the notes.
//
// Row level security is switched on with no policies. On Supabase every table
// in the public schema is reachable through its REST API with the project's
// public key; with RLS on and no policy that key sees nothing. The server
// itself connects as the table's owner, which RLS does not apply to.
const postgresSchema = `
CREATE TABLE IF NOT EXISTS notes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT 'Untitled',
  content     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  search_text TEXT NOT NULL DEFAULT '',
  changed_at  TEXT NOT NULL DEFAULT '',
  server_at   TEXT NOT NULL DEFAULT '',
  dirty       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS notes_updated_at_idx ON notes (updated_at DESC);
CREATE INDEX IF NOT EXISTS notes_server_at_idx ON notes (server_at);
CREATE TABLE IF NOT EXISTS tombstones (
  id        TEXT PRIMARY KEY,
  purged_at TEXT NOT NULL,
  server_at TEXT NOT NULL DEFAULT '',
  dirty     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS tombstones_server_at_idx ON tombstones (server_at);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  base       TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  created_at TEXT NOT NULL
);
ALTER TABLE notes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tombstones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta        ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;`

// OpenPostgres connects to a Postgres database - Supabase, in the hosted
// setup - and makes sure the tables exist.
//
// The connection uses the simple query protocol. Supabase's pooled endpoints
// sit behind PgBouncer in transaction mode, which cannot carry the prepared
// statements pgx would otherwise use, and the statements here are too few and
// too cheap for preparing them to matter.
func OpenPostgres(url string) (*Store, error) {
	cfg, err := pgx.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("reading the database URL: %w", err)
	}
	cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	db := stdlib.OpenDB(*cfg)
	// A free database allows few connections, and this server is one process
	// for one person.
	db.SetMaxOpenConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("connecting to the database: %w", err)
	}
	if _, err := db.ExecContext(ctx, postgresSchema); err != nil {
		db.Close()
		return nil, fmt.Errorf("creating schema: %w", err)
	}

	st := &Store{db: db, Path: "postgres", dialect: postgresDialect}
	st.blobs = &pgBlobs{db: db}
	if err := st.purgeExpiredTrash(); err != nil {
		db.Close()
		return nil, err
	}
	return st, nil
}

// pgBlobs keeps attachments in a table. Like the on-disk store, it names a
// file after the hash of its contents, so writing the same bytes twice is a
// no-op and a stored file never changes.
type pgBlobs struct{ db *sql.DB }

func (b *pgBlobs) insert(base, mime string, data []byte) error {
	_, err := b.db.Exec(`INSERT INTO attachments (base, mime, data, created_at)
		VALUES ($1, $2, $3, $4) ON CONFLICT (base) DO NOTHING`, base, mime, data, stamp())
	return err
}

func (b *pgBlobs) Add(name string, r io.Reader) (attach.Ref, error) {
	ref, data, err := attach.Prepare(name, r)
	if err != nil {
		return attach.Ref{}, err
	}
	return ref, b.insert(ref.Base(), ref.MIME, data)
}

func (b *pgBlobs) Open(base string) (io.ReadSeekCloser, time.Time, error) {
	if !attach.ValidBase(base) {
		return nil, time.Time{}, fmt.Errorf("%q: %w", base, attach.ErrBadName)
	}
	var (
		data    []byte
		created string
	)
	err := b.db.QueryRow(`SELECT data, created_at FROM attachments WHERE base = $1`, base).
		Scan(&data, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, time.Time{}, fmt.Errorf("%s: %w", base, attach.ErrNotFound)
	}
	if err != nil {
		return nil, time.Time{}, err
	}
	t, _ := time.Parse(stampLayout, created)
	return nopCloser{bytes.NewReader(data)}, t, nil
}

func (b *pgBlobs) List() ([]string, error) {
	rows, err := b.db.Query(`SELECT base FROM attachments`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var base string
		if err := rows.Scan(&base); err != nil {
			return nil, err
		}
		out = append(out, base)
	}
	return out, rows.Err()
}

func (b *pgBlobs) Put(base string, r io.Reader) error {
	if !attach.ValidBase(base) {
		return fmt.Errorf("%q: %w", base, attach.ErrBadName)
	}
	_, data, err := attach.Prepare(base, r)
	if err != nil {
		return err
	}
	if got := attach.HashID(data); got != attach.IDOf(base) {
		return fmt.Errorf("%s: contents hash to %s: %w", base, got, attach.ErrBadName)
	}
	head := data[:min(len(data), 512)]
	return b.insert(base, attach.MIMEFor(head, base), data)
}

type nopCloser struct{ *bytes.Reader }

func (nopCloser) Close() error { return nil }

var _ attach.Backend = (*pgBlobs)(nil)
