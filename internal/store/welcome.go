package store

// The note a brand-new database starts with. It is the first thing a reader
// sees, so it doubles as a tour of what the editor understands.
const welcomeTitle = "Welcome to nib"

const welcomeBody = `# Welcome to nib

This is Markdown, the way GitHub Gists write it.

- **bold**, *italic*, ~~strikethrough~~ and ` + "`inline code`" + `
- [x] a finished task
- [ ] one still to do
- [the Markdown guide](https://docs.github.com/en/get-started/writing-on-github)

> Press ? at any time for every key.

Some things worth trying:

1. ` + "`n`" + ` starts a new note — the first line becomes its title
2. ` + "`/`" + ` searches everything you have written
3. ` + "`w`" + ` opens the same notes in your browser
4. ` + "`d`" + ` moves a note to the trash, and ` + "`u`" + ` brings it back

Your writing saves itself as you go. ` + "`esc`" + ` and
` + "`ctrl+s`" + ` both just close the editor and keep it, and
` + "`ctrl+p`" + ` previews what you are writing.

| Key | Does |
| --- | --- |
| j k | move |
| ↵ | edit |
| q | quit |

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
