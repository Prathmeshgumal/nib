package store

// The note a brand-new database starts with. It is the first thing a reader
// sees, so it doubles as a tour of what the editor understands.
//
// It is read in both interfaces, so the keys are said per interface: one list
// of terminal keys read in the browser promised a "?" that did nothing there.
// The body does not open with the title as a heading either - both interfaces
// already show the title above it, and the browser showed it twice.
const welcomeTitle = "Welcome to nib"

const welcomeBody = `This is Markdown, the way GitHub Gists write it.

- **bold**, *italic*, ~~strikethrough~~ and ` + "`" + `inline code` + "`" + `
- [x] a finished task
- [ ] one still to do
- [the Markdown guide](https://docs.github.com/en/get-started/writing-on-github)

nib saves your writing as you go, and the terminal and the browser show the same notes.

## In the terminal

- ` + "`" + `n` + "`" + ` starts a new note — the first line becomes its title
- ` + "`" + `/` + "`" + ` searches everything you have written
- ` + "`" + `w` + "`" + ` opens the same notes in your browser
- ` + "`" + `d` + "`" + ` moves a note to the trash, and ` + "`" + `u` + "`" + ` brings it back
- ` + "`" + `esc` + "`" + ` and ` + "`" + `ctrl+s` + "`" + ` close the editor and keep it, and ` + "`" + `ctrl+p` + "`" + ` previews it
- ` + "`" + `?` + "`" + ` shows every key

## In the browser

- **New note** in the sidebar starts one — the first line becomes its title
- type ` + "`" + `/` + "`" + ` on an empty line for tables, code blocks and more
- the six dots beside a block move it, or click them for its menu (` + "`" + `ctrl+/` + "`" + `)
- ` + "`" + `ctrl+s` + "`" + ` saves straight away, and ` + "`" + `esc` + "`" + ` steps out of the text

Delete this note whenever you like — nothing depends on it.
`

// SeedIfEmpty gives a brand-new database its welcome note. An existing
// database is never touched, including one whose notes are all in the trash.
//
// The application calls this, not Open: what a first-time reader should see is
// a product decision, and a store that quietly invented a row would surprise
// anything else reading the same file.
func (s *Store) SeedIfEmpty() error {
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM notes`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	_, err := s.Create(welcomeTitle, welcomeBody)
	return err
}
