package store

import (
	"database/sql"
	"errors"
	"time"

	"github.com/Prathmeshgumal/nib/internal/attach"
)

// SyncNote is a note as it travels between a local copy and the server: the
// note itself, whether it is in the trash, and the clock the two sides settle
// disagreements by.
type SyncNote struct {
	Note
	DeletedAt string `json:"deleted_at,omitempty"`
	ChangedAt string `json:"changed_at"`
}

// Purged records that a note was destroyed for good, and when.
type Purged struct {
	ID       string `json:"id"`
	PurgedAt string `json:"purged_at"`
}

// OverlapWindow is how far back the server looks past a client's cursor. The
// cursor is a time, and two writes that commit within moments of each other
// can become visible in the opposite order to their timestamps; looking a
// little behind the cursor means such a write is seen on the next pull rather
// than never. Applying a change twice is harmless, so the cost is only a few
// repeated rows.
const OverlapWindow = time.Minute

const syncCols = `id, title, content, created_at, updated_at, COALESCE(deleted_at, ''), changed_at`

func scanSync(rows *sql.Rows) ([]SyncNote, error) {
	defer rows.Close()
	out := []SyncNote{}
	for rows.Next() {
		var n SyncNote
		if err := rows.Scan(&n.ID, &n.Title, &n.Content, &n.CreatedAt, &n.UpdatedAt,
			&n.DeletedAt, &n.ChangedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func scanPurged(rows *sql.Rows) ([]Purged, error) {
	defer rows.Close()
	out := []Purged{}
	for rows.Next() {
		var p Purged
		if err := rows.Scan(&p.ID, &p.PurgedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Dirty is everything changed here since it was last sent: live notes, trashed
// ones, and the notes destroyed.
func (s *Store) Dirty() ([]SyncNote, []Purged, error) {
	rows, err := s.query(`SELECT ` + syncCols + ` FROM notes WHERE dirty = 1`)
	if err != nil {
		return nil, nil, err
	}
	notes, err := scanSync(rows)
	if err != nil {
		return nil, nil, err
	}
	rows, err = s.query(`SELECT id, purged_at FROM tombstones WHERE dirty = 1`)
	if err != nil {
		return nil, nil, err
	}
	purged, err := scanPurged(rows)
	return notes, purged, err
}

// MarkClean records that these were sent. A note is only cleared if it has not
// changed since it was read: one edited while the request was in flight stays
// dirty and goes out on the next sync.
func (s *Store) MarkClean(notes []SyncNote, purged []Purged) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, n := range notes {
		if _, err := tx.Exec(s.rebind(`UPDATE notes SET dirty = 0 WHERE id = ? AND changed_at = ?`),
			n.ID, n.ChangedAt); err != nil {
			return err
		}
	}
	for _, p := range purged {
		if _, err := tx.Exec(s.rebind(`UPDATE tombstones SET dirty = 0 WHERE id = ? AND purged_at = ?`),
			p.ID, p.PurgedAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ChangesSince is everything written here after the cursor, by the clock of
// this machine rather than of whoever wrote it. That is what makes it safe for
// the server to hand out: a note pushed by a device whose clock is hours slow
// still carries a recent server time, so no other device misses it.
func (s *Store) ChangesSince(cursor string) ([]SyncNote, []Purged, error) {
	rows, err := s.query(`SELECT `+syncCols+` FROM notes WHERE server_at > ?`, cursor)
	if err != nil {
		return nil, nil, err
	}
	notes, err := scanSync(rows)
	if err != nil {
		return nil, nil, err
	}
	rows, err = s.query(`SELECT id, purged_at FROM tombstones WHERE server_at > ?`, cursor)
	if err != nil {
		return nil, nil, err
	}
	purged, err := scanPurged(rows)
	return notes, purged, err
}

// MarkAllDirty flags everything for sending. A device that starts syncing with
// a different server than before has to offer that server its whole library,
// not just what changed since the last, unrelated, sync.
func (s *Store) MarkAllDirty() error {
	if _, err := s.exec(`UPDATE notes SET dirty = 1`); err != nil {
		return err
	}
	_, err := s.exec(`UPDATE tombstones SET dirty = 1`)
	return err
}

// Cursor is the server's time, in the format ChangesSince compares against.
func Cursor() string { return stamp() }

// CursorBefore is where a pull should start for a client that last saw cursor.
func CursorBefore(cursor string) string {
	t, err := time.Parse(stampLayout, cursor)
	if err != nil {
		return "" // an unreadable cursor means "from the beginning"
	}
	return t.Add(-OverlapWindow).Format(stampLayout)
}

// later reports whether a is strictly after b. The columns it compares are
// written in two layouts, so they are parsed rather than compared as text.
func later(a, b string) bool {
	ta, errA := parseTime(a)
	tb, errB := parseTime(b)
	if errA != nil || errB != nil {
		return a > b
	}
	return ta.After(tb)
}

func parseTime(v string) (time.Time, error) {
	if t, err := time.Parse(stampLayout, v); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339Nano, v)
}

// Apply merges changes that came from the other side, newest write wins.
//
// A change older than what is already held is dropped, so applying the same
// batch twice, or an old batch after a new one, changes nothing. Destroyed
// notes are applied first: a note edited after it was destroyed elsewhere is
// then seen to be newer than the tombstone, and brought back.
func (s *Store) Apply(notes []SyncNote, purged []Purged) (applied int, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	srv := stamp()

	for _, p := range purged {
		var changed string
		err := tx.QueryRow(s.rebind(`SELECT changed_at FROM notes WHERE id = ?`), p.ID).Scan(&changed)
		switch {
		case errors.Is(err, sql.ErrNoRows):
		case err != nil:
			return 0, err
		case later(changed, p.PurgedAt):
			continue // the note was written after it was destroyed elsewhere
		default:
			if _, err := tx.Exec(s.rebind(`DELETE FROM notes WHERE id = ?`), p.ID); err != nil {
				return 0, err
			}
		}
		if _, err := tx.Exec(s.rebind(`INSERT INTO tombstones (id, purged_at, server_at, dirty)
			VALUES (?, ?, ?, 0)
			ON CONFLICT (id) DO UPDATE SET purged_at = excluded.purged_at,
				server_at = excluded.server_at
			WHERE tombstones.purged_at < excluded.purged_at`), p.ID, p.PurgedAt, srv); err != nil {
			return 0, err
		}
		applied++
	}

	for _, n := range notes {
		var have string
		err := tx.QueryRow(s.rebind(`SELECT changed_at FROM notes WHERE id = ?`), n.ID).Scan(&have)
		if err == nil && !later(n.ChangedAt, have) {
			continue
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return 0, err
		}

		var purgedAt string
		err = tx.QueryRow(s.rebind(`SELECT purged_at FROM tombstones WHERE id = ?`), n.ID).Scan(&purgedAt)
		if err == nil {
			if !later(n.ChangedAt, purgedAt) {
				continue // destroyed after this version was written
			}
			if _, err := tx.Exec(s.rebind(`DELETE FROM tombstones WHERE id = ?`), n.ID); err != nil {
				return 0, err
			}
		} else if !errors.Is(err, sql.ErrNoRows) {
			return 0, err
		}

		var deleted any
		if n.DeletedAt != "" {
			deleted = n.DeletedAt
		}
		if _, err := tx.Exec(s.rebind(`INSERT INTO notes
			(id, title, content, created_at, updated_at, deleted_at, search_text, changed_at, server_at, dirty)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
			ON CONFLICT (id) DO UPDATE SET title = excluded.title, content = excluded.content,
				created_at = excluded.created_at, updated_at = excluded.updated_at,
				deleted_at = excluded.deleted_at, search_text = excluded.search_text,
				changed_at = excluded.changed_at, server_at = excluded.server_at, dirty = 0`),
			n.ID, n.Title, n.Content, n.CreatedAt, n.UpdatedAt, deleted,
			Unescape(n.Content), n.ChangedAt, srv); err != nil {
			return 0, err
		}
		applied++
	}
	return applied, tx.Commit()
}

// Meta reads a small value the sync client keeps about itself, such as how far
// it has pulled. It reports "" for a key never set.
func (s *Store) Meta(key string) (string, error) {
	var v string
	err := s.queryRow(`SELECT value FROM meta WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

// SetMeta writes one.
func (s *Store) SetMeta(key, value string) error {
	_, err := s.exec(`INSERT INTO meta (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// ReferencedAttachments is the stored name of every attachment any note,
// trashed ones included, refers to - the files a sync has to make sure both
// sides hold. The notes carry the id; the extension comes from the file list.
func (s *Store) ReferencedAttachments() (map[string]struct{}, error) {
	rows, err := s.query(`SELECT content FROM notes`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := map[string]struct{}{}
	for rows.Next() {
		var content string
		if err := rows.Scan(&content); err != nil {
			return nil, err
		}
		for _, id := range attach.Refs(content) {
			ids[id] = struct{}{}
		}
	}
	return ids, rows.Err()
}
