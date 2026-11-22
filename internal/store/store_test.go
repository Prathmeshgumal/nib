package store

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "notes.db"))
	if err != nil {
		t.Fatalf("opening store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestCRUD(t *testing.T) {
	st := newTestStore(t)

	created, err := st.Create("", "# Title from body\n\nrest")
	if err != nil {
		t.Fatal(err)
	}
	if created.Title != "Title from body" {
		t.Errorf("title = %q, want it derived from the first line", created.Title)
	}

	got, err := st.Get(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != created.Content {
		t.Errorf("content round-trip mismatch")
	}

	updated, err := st.Update(created.ID, "Explicit", "new body")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != "Explicit" || updated.Content != "new body" {
		t.Errorf("update did not apply: %+v", updated)
	}
	if updated.UpdatedAt == created.UpdatedAt {
		t.Error("updated_at should move forward on update")
	}

	if err := st.Delete(created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Get(created.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("after delete, Get returned %v, want ErrNotFound", err)
	}
}

func TestMissingIDsReportNotFound(t *testing.T) {
	st := newTestStore(t)
	if _, err := st.Get("nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get: %v", err)
	}
	if _, err := st.Update("nope", "a", "b"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Update: %v", err)
	}
	if err := st.Delete("nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Delete: %v", err)
	}
}

func TestSearchMatchesTitleAndBody(t *testing.T) {
	st := newTestStore(t)
	if _, err := st.Create("Groceries", "milk and eggs"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Create("Ideas", "write a notes app"); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct{ query, want string }{
		{"groceries", "Groceries"}, // title, case-insensitive
		{"eggs", "Groceries"},      // body
		{"NOTES", "Ideas"},         // body, different case
	} {
		got, err := st.List(tc.query)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 1 || got[0].Title != tc.want {
			t.Errorf("List(%q) = %v, want one hit %q", tc.query, titles(got), tc.want)
		}
	}

	all, err := st.List("")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Errorf("empty query should return everything, got %d", len(all))
	}
}

func TestListIsNewestFirst(t *testing.T) {
	st := newTestStore(t)
	first, _ := st.Create("first", "a")
	second, _ := st.Create("second", "b")

	got, err := st.List("")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != second.ID || got[1].ID != first.ID {
		t.Errorf("order = %v, want newest first", titles(got))
	}
}

func TestDeriveTitle(t *testing.T) {
	for _, tc := range []struct{ title, content, want string }{
		{"Explicit", "body", "Explicit"},
		{"", "# Heading\nbody", "Heading"},
		{"", "\n\n  spaced first line", "spaced first line"},
		{"", "", "Untitled"},
		{"   ", "   ", "Untitled"},
		{"", "This&#x20;\nmore", "This"},
	} {
		if got := DeriveTitle(tc.title, tc.content); got != tc.want {
			t.Errorf("DeriveTitle(%q, %q) = %q, want %q", tc.title, tc.content, got, tc.want)
		}
	}
}

func TestIDsAreUniqueUUIDs(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 1000; i++ {
		id := newID()
		if len(id) != 36 {
			t.Fatalf("id %q is not UUID-shaped", id)
		}
		if seen[id] {
			t.Fatalf("duplicate id generated: %s", id)
		}
		seen[id] = true
	}
}

func titles(notes []Note) []string {
	out := make([]string, len(notes))
	for i, n := range notes {
		out[i] = n.Title
	}
	return out
}

// A brand-new database should not open on an empty screen.
func TestNewDatabaseGetsAWelcomeNote(t *testing.T) {
	st := newTestStore(t)
	if err := st.SeedIfEmpty(); err != nil {
		t.Fatal(err)
	}
	notes, err := st.List("")
	if err != nil {
		t.Fatal(err)
	}
	if len(notes) != 1 {
		t.Fatalf("a new database holds %d notes, want 1", len(notes))
	}
	if notes[0].Title != welcomeTitle {
		t.Errorf("title = %q, want the welcome note", notes[0].Title)
	}
}

// Reopening must not add it again, and neither must a database whose notes
// have all been deleted — that is a used database, not a new one.
func TestWelcomeNoteIsOnlyAddedOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.db")

	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SeedIfEmpty(); err != nil {
		t.Fatal(err)
	}
	notes := mustListStore(t, st)
	if err := st.Delete(notes[0].ID); err != nil {
		t.Fatal(err)
	}
	st.Close()

	st2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st2.Close()
	if err := st2.SeedIfEmpty(); err != nil {
		t.Fatal(err)
	}
	if got := len(mustListStore(t, st2)); got != 0 {
		t.Errorf("a used database was re-seeded: %d notes", got)
	}
}

// The welcome note is the first thing anyone reads, so it must not carry a
// name the program no longer goes by.
func TestWelcomeNoteUsesTheCurrentName(t *testing.T) {
	if strings.Contains(welcomeTitle, "note") && !strings.Contains(welcomeTitle, "nib") {
		t.Errorf("welcome title still says %q", welcomeTitle)
	}
	if !strings.Contains(welcomeBody, "nib") {
		t.Error("the welcome note never mentions the program by name")
	}
	for _, stale := range []string{"Welcome to note", "$ note", "`note`"} {
		if strings.Contains(welcomeBody, stale) {
			t.Errorf("the welcome note still contains %q", stale)
		}
	}
}
