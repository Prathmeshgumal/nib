package store

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// A title nobody chose follows the first line, so a note keeps the name its
// opening words give it while those words are still being written.
func TestUnsetTitleFollowsTheFirstLine(t *testing.T) {
	st := newTestStore(t)
	n, _ := st.Create("", "shopping list\nmilk")
	if n.Title != "shopping list" || n.TitleSet {
		t.Fatalf("created %q set=%v, want the first line, unset", n.Title, n.TitleSet)
	}
	n, err := st.UpdateContent(n.ID, "groceries\nmilk")
	if err != nil {
		t.Fatal(err)
	}
	if n.Title != "groceries" {
		t.Errorf("title = %q, want it to follow the first line", n.Title)
	}
}

// The bug: a title someone typed went back to the first line as soon as the
// body was saved by anything that did not know about the rename.
func TestChosenTitleSurvivesContentSaves(t *testing.T) {
	st := newTestStore(t)
	n, _ := st.Create("", "shopping list")
	n, _ = st.Update(n.ID, "Groceries", "shopping list")
	if !n.TitleSet {
		t.Fatal("a typed title was not remembered as chosen")
	}
	n, err := st.UpdateContent(n.ID, "shopping list and eggs")
	if err != nil {
		t.Fatal(err)
	}
	if n.Title != "Groceries" {
		t.Errorf("title = %q, want the chosen one kept", n.Title)
	}
	if n.Content != "shopping list and eggs" {
		t.Errorf("content = %q, want the new body", n.Content)
	}
}

// Clearing the title hands the name back to the first line.
func TestClearingATitleGoesBackToTheFirstLine(t *testing.T) {
	st := newTestStore(t)
	n, _ := st.Create("Groceries", "shopping list")
	if !n.TitleSet {
		t.Fatal("a title given on create was not remembered as chosen")
	}
	n, _ = st.Update(n.ID, "  ", "shopping list")
	if n.Title != "shopping list" || n.TitleSet {
		t.Errorf("got %q set=%v, want the first line, unset", n.Title, n.TitleSet)
	}
}

func TestUpdateContentOfAMissingNote(t *testing.T) {
	st := newTestStore(t)
	if _, err := st.UpdateContent("nope", "x"); err != ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

// Notes written before the column existed: a title that differs from the
// first line was typed by someone; one that matches it was worked out.
func TestExistingTitlesAreSortedOnUpgrade(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE notes (
		id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled',
		content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL, deleted_at TEXT,
		search_text TEXT NOT NULL DEFAULT '');`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO notes (id, title, content, created_at, updated_at)
		VALUES ('a', 'shopping list', ?, 't', 't'), ('b', 'Groceries', 'shopping list', 't', 't')`,
		"# shopping list\nmilk")
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	a, _ := st.Get("a")
	b, _ := st.Get("b")
	if a.TitleSet {
		t.Error("a title equal to the first line was taken as chosen")
	}
	if !b.TitleSet {
		t.Error("a title different from the first line was taken as worked out")
	}
}
