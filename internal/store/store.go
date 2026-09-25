// Package store is the single source of truth for notes. Both the terminal UI
// and the web server talk to it; it owns a plain SQLite file on disk.
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Prathmeshgumal/nib/internal/attach"
	_ "modernc.org/sqlite" // pure-Go driver: no cgo, no system libraries
)

type Note struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type Store struct {
	db     *sql.DB
	Path   string
	attach *attach.Store
}

var ErrNotFound = errors.New("note not found")

const schema = `
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT 'Untitled',
  content    TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  search_text TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS notes_updated_at_idx ON notes (updated_at DESC);`

// TrashRetention is how long a deleted note stays recoverable.
const TrashRetention = 30 * 24 * time.Hour

// Open prepares the database file, creating parent directories as needed.
func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("creating data directory: %w", err)
	}
	// WAL lets the TUI and the web server use the file at the same time.
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("opening %s: %w", path, err)
	}
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("creating schema: %w", err)
	}
	// Databases created before the trash existed need the extra column.
	if _, err := db.Exec(`ALTER TABLE notes ADD COLUMN deleted_at TEXT`); err != nil &&
		!strings.Contains(err.Error(), "duplicate column") {
		return nil, fmt.Errorf("migrating schema: %w", err)
	}
	// Databases created before search kept a plain copy need one too. A nil
	// error means the column was added just now, so every row in it is empty
	// and has to be filled before the first search reads it.
	if _, err := db.Exec(`ALTER TABLE notes ADD COLUMN search_text TEXT NOT NULL DEFAULT ''`); err == nil {
		if err := backfillSearchText(db); err != nil {
			return nil, fmt.Errorf("migrating schema: %w", err)
		}
	} else if !strings.Contains(err.Error(), "duplicate column") {
		return nil, fmt.Errorf("migrating schema: %w", err)
	}
	// Attachments live beside the database rather than in a fixed place, so
	// pointing --db somewhere else takes the files along and the relative
	// links inside the notes keep resolving.
	at, err := attach.Open(filepath.Join(filepath.Dir(path), "attachments"))
	if err != nil {
		return nil, err
	}

	st := &Store{db: db, Path: path, attach: at}
	if err := st.purgeExpiredTrash(); err != nil {
		return nil, err
	}
	if _, err := at.PurgeExpired(TrashRetention); err != nil {
		return nil, err
	}
	if _, _, err := st.SweepAttachments(); err != nil {
		return nil, err
	}
	return st, nil
}

// Attachments is the store for the files the notes refer to.
func (s *Store) Attachments() *attach.Store { return s.attach }

// SweepAttachments reconciles the attachments directory against the notes.
//
// Deleted notes count. A note in the trash is recoverable for TrashRetention,
// so its files have to outlive it by at least as long, or restoring a note
// hands back broken images. Gathering the set here rather than in each caller
// is what stops anyone forgetting that.
func (s *Store) SweepAttachments() (trashed, restored int, err error) {
	rows, err := s.db.Query(`SELECT content FROM notes`)
	if err != nil {
		return 0, 0, fmt.Errorf("reading note contents: %w", err)
	}
	defer rows.Close()

	referenced := map[string]struct{}{}
	for rows.Next() {
		var content string
		if err := rows.Scan(&content); err != nil {
			return 0, 0, err
		}
		for _, id := range attach.Refs(content) {
			referenced[id] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}
	return s.attach.Sweep(referenced)
}

func (s *Store) Close() error { return s.db.Close() }

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func scan(rows *sql.Rows) ([]Note, error) {
	defer rows.Close()
	notes := []Note{}
	for rows.Next() {
		var n Note
		if err := rows.Scan(&n.ID, &n.Title, &n.Content, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		notes = append(notes, n)
	}
	return notes, rows.Err()
}

// List returns notes newest-first, optionally filtered by a substring match on
// the title or body. SQLite's LIKE is already case-insensitive for ASCII.
func (s *Store) List(query string) ([]Note, error) {
	const cols = `SELECT id, title, content, created_at, updated_at FROM notes`
	if q := strings.TrimSpace(query); q != "" {
		like := likePattern(q)
		// search_text, not content: it is the same words with a serializer's
		// backslashes taken out, so what the typist wrote is what matches.
		rows, err := s.db.Query(cols+` WHERE deleted_at IS NULL
			AND (title LIKE ? ESCAPE '\' OR search_text LIKE ? ESCAPE '\')
			ORDER BY updated_at DESC`, like, like)
		if err != nil {
			return nil, err
		}
		return scan(rows)
	}
	rows, err := s.db.Query(cols + ` WHERE deleted_at IS NULL ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	return scan(rows)
}

func (s *Store) Get(id string) (Note, error) {
	var n Note
	err := s.db.QueryRow(
		`SELECT id, title, content, created_at, updated_at FROM notes
		 WHERE id = ? AND deleted_at IS NULL`, id,
	).Scan(&n.ID, &n.Title, &n.Content, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return n, ErrNotFound
	}
	return n, err
}

func (s *Store) Create(title, content string) (Note, error) {
	n := Note{
		ID:        newID(),
		Title:     DeriveTitle(title, content),
		Content:   content,
		CreatedAt: now(),
		UpdatedAt: now(),
	}
	_, err := s.db.Exec(
		`INSERT INTO notes (id, title, content, created_at, updated_at, search_text)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		n.ID, n.Title, n.Content, n.CreatedAt, n.UpdatedAt, Unescape(n.Content))
	return n, err
}

func (s *Store) Update(id, title, content string) (Note, error) {
	res, err := s.db.Exec(`UPDATE notes SET title = ?, content = ?, updated_at = ?, search_text = ?
		WHERE id = ? AND deleted_at IS NULL`,
		DeriveTitle(title, content), content, now(), Unescape(content), id)
	if err != nil {
		return Note{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Note{}, ErrNotFound
	}
	return s.Get(id)
}

// Delete moves a note to the trash rather than destroying it. Trashed notes
// stay recoverable for TrashRetention before being purged on the next open.
func (s *Store) Delete(id string) error {
	res, err := s.db.Exec(`UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
		now(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Restore brings a trashed note back.
func (s *Store) Restore(id string) error {
	res, err := s.db.Exec(`UPDATE notes SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Trash lists what is currently recoverable, most recently deleted first.
func (s *Store) Trash() ([]Note, error) {
	rows, err := s.db.Query(`SELECT id, title, content, created_at, updated_at FROM notes
		WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)
	if err != nil {
		return nil, err
	}
	return scan(rows)
}

// Purge permanently removes a single trashed note. This cannot be undone, so
// it refuses to touch a note that is still live.
func (s *Store) Purge(id string) error {
	res, err := s.db.Exec(`DELETE FROM notes WHERE id = ? AND deleted_at IS NOT NULL`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// EmptyTrash permanently removes every trashed note and reports how many went.
// Live notes are untouched.
func (s *Store) EmptyTrash() (int, error) {
	res, err := s.db.Exec(`DELETE FROM notes WHERE deleted_at IS NOT NULL`)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func (s *Store) purgeExpiredTrash() error {
	cutoff := time.Now().UTC().Add(-TrashRetention).Format(time.RFC3339Nano)
	_, err := s.db.Exec(`DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?`, cutoff)
	return err
}

func (s *Store) Count() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT count(*) FROM notes WHERE deleted_at IS NULL`).Scan(&n)
	return n, err
}

// DeriveTitle falls back to the first meaningful line of the body, gist-style,
// when no explicit title was given.
func DeriveTitle(title, content string) string {
	if t := strings.TrimSpace(title); t != "" {
		return truncate(t, 200)
	}
	for _, line := range strings.Split(content, "\n") {
		if t := strings.TrimSpace(strings.TrimLeft(line, "# ")); t != "" {
			return truncate(t, 200)
		}
	}
	return "Untitled"
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
