package store

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Prathmeshgumal/nib/internal/attach"
)

// eachBackend runs a test against SQLite, and against Postgres too when
// NIB_TEST_POSTGRES names a database to use. The Postgres tables are emptied
// first, so point it at a scratch database and nothing else.
func eachBackend(t *testing.T, fn func(t *testing.T, st *Store)) {
	t.Run("sqlite", func(t *testing.T) { fn(t, newTestStore(t)) })

	url := os.Getenv("NIB_TEST_POSTGRES")
	if url == "" {
		return
	}
	t.Run("postgres", func(t *testing.T) {
		st, err := OpenPostgres(url)
		if err != nil {
			t.Fatalf("opening postgres: %v", err)
		}
		t.Cleanup(func() { st.Close() })
		if _, err := st.db.Exec(`TRUNCATE notes, tombstones, meta, attachments`); err != nil {
			t.Fatal(err)
		}
		fn(t, st)
	})
}

func TestBackendBasics(t *testing.T) {
	eachBackend(t, func(t *testing.T, st *Store) {
		a, err := st.Create("Groceries", "milk and EGGS")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := st.Create("Other", "nothing relevant"); err != nil {
			t.Fatal(err)
		}

		got, err := st.List("eggs")
		if err != nil || len(got) != 1 || got[0].ID != a.ID {
			t.Fatalf("search = %v, %v; want only the groceries note", got, err)
		}
		if got, _ := st.List("100%"); len(got) != 0 {
			t.Errorf("a literal percent sign matched %d notes", len(got))
		}

		if _, err := st.Update(a.ID, "Groceries", "milk and bread"); err != nil {
			t.Fatal(err)
		}
		if err := st.Delete(a.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := st.Get(a.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("a trashed note should not be gettable, got %v", err)
		}
		if trash, _ := st.Trash(); len(trash) != 1 {
			t.Errorf("trash has %d notes, want 1", len(trash))
		}
		if err := st.Restore(a.ID); err != nil {
			t.Fatal(err)
		}
		if err := st.Purge(a.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("purging a live note should refuse, got %v", err)
		}
		if err := st.Delete(a.ID); err != nil {
			t.Fatal(err)
		}
		if err := st.Purge(a.ID); err != nil {
			t.Fatal(err)
		}
		_, purged, err := st.Dirty()
		if err != nil || len(purged) != 1 || purged[0].ID != a.ID {
			t.Errorf("purging should leave a tombstone, got %v, %v", purged, err)
		}
	})
}

func TestDirtyTracksLocalWritesOnly(t *testing.T) {
	eachBackend(t, func(t *testing.T, st *Store) {
		n, _ := st.Create("A", "one")
		notes, _, _ := st.Dirty()
		if len(notes) != 1 {
			t.Fatalf("a new note should be dirty, got %d", len(notes))
		}
		if err := st.MarkClean(notes, nil); err != nil {
			t.Fatal(err)
		}
		if notes, _, _ := st.Dirty(); len(notes) != 0 {
			t.Fatalf("sent notes should be clean, got %d", len(notes))
		}

		// A change that lands while a request is in flight must not be lost.
		sent, _, _ := st.Dirty()
		st.Update(n.ID, "A", "two")
		sent = []SyncNote{{Note: n, ChangedAt: "stale"}}
		st.MarkClean(sent, nil)
		if notes, _, _ := st.Dirty(); len(notes) != 1 {
			t.Errorf("a note edited after it was read must stay dirty, got %d", len(notes))
		}

		// What arrives from the other side is not something to send back.
		fresh := SyncNote{
			Note:      Note{ID: "remote-1", Title: "R", Content: "from afar", CreatedAt: now(), UpdatedAt: now()},
			ChangedAt: stamp(),
		}
		if _, err := st.Apply([]SyncNote{fresh}, nil); err != nil {
			t.Fatal(err)
		}
		for _, d := range mustDirty(t, st) {
			if d.ID == "remote-1" {
				t.Error("an applied note should not be dirty")
			}
		}
	})
}

func mustDirty(t *testing.T, st *Store) []SyncNote {
	t.Helper()
	notes, _, err := st.Dirty()
	if err != nil {
		t.Fatal(err)
	}
	return notes
}

func TestApplyNewestWriteWins(t *testing.T) {
	eachBackend(t, func(t *testing.T, st *Store) {
		mk := func(content, changed string) SyncNote {
			return SyncNote{
				Note:      Note{ID: "n1", Title: "T", Content: content, CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z"},
				ChangedAt: changed,
			}
		}
		const early, mid, late = "2026-01-01T00:00:01.000000Z", "2026-01-01T00:00:02.000000Z", "2026-01-01T00:00:03.000000Z"

		if n, _ := st.Apply([]SyncNote{mk("mid", mid)}, nil); n != 1 {
			t.Fatalf("first apply = %d, want 1", n)
		}
		if n, _ := st.Apply([]SyncNote{mk("early", early)}, nil); n != 0 {
			t.Errorf("an older write applied")
		}
		if n, _ := st.Apply([]SyncNote{mk("mid", mid)}, nil); n != 0 {
			t.Errorf("the same write applied twice")
		}
		if n, _ := st.Apply([]SyncNote{mk("late", late)}, nil); n != 1 {
			t.Errorf("a newer write was dropped")
		}
		got, err := st.Get("n1")
		if err != nil || got.Content != "late" {
			t.Errorf("content = %q, %v; want the newest", got.Content, err)
		}
	})
}

func TestApplyCarriesTheTrash(t *testing.T) {
	eachBackend(t, func(t *testing.T, st *Store) {
		n := SyncNote{
			Note:      Note{ID: "n1", Title: "T", Content: "x", CreatedAt: now(), UpdatedAt: now()},
			DeletedAt: now(),
			ChangedAt: stamp(),
		}
		st.Apply([]SyncNote{n}, nil)
		if _, err := st.Get("n1"); !errors.Is(err, ErrNotFound) {
			t.Errorf("a note applied as trashed should be in the trash, got %v", err)
		}
		if trash, _ := st.Trash(); len(trash) != 1 {
			t.Errorf("trash has %d, want 1", len(trash))
		}
	})
}

func TestTombstonesAndResurrection(t *testing.T) {
	eachBackend(t, func(t *testing.T, st *Store) {
		const t1, t2, t3 = "2026-01-01T00:00:01.000000Z", "2026-01-01T00:00:02.000000Z", "2026-01-01T00:00:03.000000Z"
		note := func(changed string) SyncNote {
			return SyncNote{Note: Note{ID: "n1", Title: "T", Content: "x", CreatedAt: t1, UpdatedAt: t1}, ChangedAt: changed}
		}

		st.Apply([]SyncNote{note(t1)}, nil)
		// Destroyed elsewhere after this version: it goes.
		st.Apply(nil, []Purged{{ID: "n1", PurgedAt: t2}})
		if _, err := st.Get("n1"); !errors.Is(err, ErrNotFound) {
			t.Fatal("the destroyed note survived")
		}
		// A straggler older than the tombstone must not bring it back.
		if n, _ := st.Apply([]SyncNote{note(t1)}, nil); n != 0 {
			t.Error("a note older than its tombstone was applied")
		}
		// One written after the tombstone is a real edit, and wins.
		if n, _ := st.Apply([]SyncNote{note(t3)}, nil); n != 1 {
			t.Error("a note newer than its tombstone was refused")
		}
		if _, err := st.Get("n1"); err != nil {
			t.Errorf("the resurrected note is missing: %v", err)
		}
		// And the old tombstone no longer applies to it.
		st.Apply(nil, []Purged{{ID: "n1", PurgedAt: t2}})
		if _, err := st.Get("n1"); err != nil {
			t.Errorf("a stale tombstone destroyed a newer note: %v", err)
		}
	})
}

func TestChangesSinceUsesTheServerClock(t *testing.T) {
	eachBackend(t, func(t *testing.T, st *Store) {
		before := Cursor()
		// Written by a device whose own clock is years behind.
		st.Apply([]SyncNote{{
			Note:      Note{ID: "slow", Title: "T", Content: "x", CreatedAt: "2020-01-01T00:00:00Z", UpdatedAt: "2020-01-01T00:00:00Z"},
			ChangedAt: "2020-01-01T00:00:00.000000Z",
		}}, nil)
		got, _, err := st.ChangesSince(before)
		if err != nil || len(got) != 1 {
			t.Fatalf("a note from a slow clock was not offered: %v, %v", got, err)
		}
		if after, _, _ := st.ChangesSince(Cursor()); len(after) != 0 {
			t.Errorf("nothing changed since now, got %d", len(after))
		}
	})
}

func TestBlobsRoundTrip(t *testing.T) {
	eachBackend(t, func(t *testing.T, st *Store) {
		data := []byte("\x89PNG\r\n\x1a\n not really a png but it says it is")
		ref, err := st.Blobs().Add("pic.png", bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := st.Blobs().Add("again.png", bytes.NewReader(data)); err != nil {
			t.Fatalf("adding the same bytes twice: %v", err)
		}
		f, _, err := st.Blobs().Open(ref.Base())
		if err != nil {
			t.Fatal(err)
		}
		got, _ := io.ReadAll(f)
		f.Close()
		if !bytes.Equal(got, data) {
			t.Error("bytes changed on the way through")
		}
		list, _ := st.Blobs().List()
		if len(list) != 1 || list[0] != ref.Base() {
			t.Errorf("list = %v, want just %s", list, ref.Base())
		}

		// Put refuses bytes that are not the ones the name promises.
		if err := st.Blobs().Put(ref.Base(), strings.NewReader("different")); !errors.Is(err, attach.ErrBadName) {
			t.Errorf("a mismatched put should be refused, got %v", err)
		}
		other := []byte("some other file entirely")
		name := attach.HashID(other) + ".txt"
		if err := st.Blobs().Put(name, bytes.NewReader(other)); err != nil {
			t.Fatalf("a matching put: %v", err)
		}
		if _, _, err := st.Blobs().Open("../../etc/passwd"); !errors.Is(err, attach.ErrBadName) {
			t.Errorf("a path-like name should be refused, got %v", err)
		}
		if _, _, err := st.Blobs().Open("0123456789abcdef.png"); !errors.Is(err, attach.ErrNotFound) {
			t.Errorf("a missing file should be not-found, got %v", err)
		}
	})
}

func TestOpenMigratesAnOldDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	old, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	// Recreate the table as it was before sync: no change clock at all.
	for _, q := range []string{
		`DROP TABLE notes`, `DROP TABLE tombstones`, `DROP TABLE meta`,
		`CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled',
			content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
			deleted_at TEXT, search_text TEXT NOT NULL DEFAULT '')`,
		`INSERT INTO notes (id, title, content, created_at, updated_at, search_text)
			VALUES ('x', 'Old', 'body', '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z', 'body')`,
	} {
		if _, err := old.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	old.Close()

	st, err := Open(path)
	if err != nil {
		t.Fatalf("reopening an old database: %v", err)
	}
	defer st.Close()
	notes, _, err := st.Dirty()
	if err != nil || len(notes) != 1 {
		t.Fatalf("an old note should be dirty so the first sync sends it: %v, %v", notes, err)
	}
	if notes[0].ChangedAt != "2025-02-01T00:00:00Z" {
		t.Errorf("changed_at = %q, want it taken from updated_at", notes[0].ChangedAt)
	}
}
