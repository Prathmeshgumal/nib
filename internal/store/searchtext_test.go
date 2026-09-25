package store

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestUnescapeDropsMarkdownEscapes(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"underscore", `store\_Open`, "store_Open"},
		{"asterisk", `2 \* 3`, "2 * 3"},
		{"several", `a\_b\*c\[d\]`, "a_b*c[d]"},
		{"escaped backslash", `C:\\Users`, `C:\Users`},
		// \U is not a markdown escape: U is not ASCII punctuation, so the
		// backslash is literal and has to survive. Windows paths depend on it.
		{"windows path", `C:\Users\prathmesh`, `C:\Users\prathmesh`},
		{"trailing backslash", `ends with \`, `ends with \`},
		{"nothing to do", "plain text", "plain text"},
		{"unicode untouched", `caf\é`, `caf\é`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Unescape(c.in); got != c.want {
				t.Errorf("Unescape(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestCreateStoresSearchText(t *testing.T) {
	s := newTestStore(t)
	n, err := s.Create("", `Call store\_Open now.`)
	if err != nil {
		t.Fatal(err)
	}
	var got string
	if err := s.db.QueryRow(`SELECT search_text FROM notes WHERE id = ?`, n.ID).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if want := "Call store_Open now."; got != want {
		t.Errorf("search_text = %q, want %q", got, want)
	}
}

func TestUpdateRewritesSearchText(t *testing.T) {
	s := newTestStore(t)
	n, err := s.Create("", "first")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(n.ID, "", `then a\*b`); err != nil {
		t.Fatal(err)
	}
	var got string
	if err := s.db.QueryRow(`SELECT search_text FROM notes WHERE id = ?`, n.ID).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if want := "then a*b"; got != want {
		t.Errorf("search_text = %q, want %q", got, want)
	}
}

// The path every existing database takes: the column is added on first open
// and the notes already in it have to be filled, or they vanish from search.
func TestOpeningAnOlderDatabaseBackfillsSearchText(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.db")

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE notes (
		id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
		created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(
		`INSERT INTO notes VALUES ('old1', 'Old', 'Call store\_Open now.', '2026-01-01', '2026-01-01', NULL)`,
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	var got string
	if err := st.db.QueryRow(`SELECT search_text FROM notes WHERE id = 'old1'`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if want := "Call store_Open now."; got != want {
		t.Errorf("search_text = %q, want %q", got, want)
	}

	// Opening again must not disturb what the first open wrote.
	st.Close()
	st2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st2.Close()
	if err := st2.db.QueryRow(`SELECT search_text FROM notes WHERE id = 'old1'`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if want := "Call store_Open now."; got != want {
		t.Errorf("after reopening, search_text = %q, want %q", got, want)
	}
}

func TestSearchFindsTextThatWasEscaped(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Create("", `Call store\_Open before autosave\_delay fires.`); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{"store_Open", "autosave_delay"} {
		got, err := s.List(q)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 1 {
			t.Errorf("List(%q) returned %d notes, want 1", q, len(got))
		}
	}
}

// SQLite's LIKE reads _ as "any one character" and % as "anything at all". An
// unescaped query handed both straight to the pattern, so searching for a name
// with an underscore in it quietly matched a good deal more than it said.
func TestSearchTreatsWildcardsAsLiteralText(t *testing.T) {
	s := newTestStore(t)
	for _, c := range []string{
		"store_Open is the one we want",
		"storeXOpen is not",
		"100% done",
		"100 percent done",
	} {
		if _, err := s.Create("", c); err != nil {
			t.Fatal(err)
		}
	}

	if got, _ := s.List("store_Open"); len(got) != 1 {
		t.Errorf(`List("store_Open") returned %d notes, want 1`, len(got))
	}
	if got, _ := s.List("100%"); len(got) != 1 {
		t.Errorf(`List("100%%") returned %d notes, want 1`, len(got))
	}
}

func TestTitleDropsSerializerEscapes(t *testing.T) {
	s := newTestStore(t)
	n, err := s.Create("", `# Call store\_Open first`)
	if err != nil {
		t.Fatal(err)
	}
	if want := "Call store_Open first"; n.Title != want {
		t.Errorf("Title = %q, want %q", n.Title, want)
	}
}
