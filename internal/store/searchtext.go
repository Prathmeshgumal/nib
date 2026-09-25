package store

import (
	"database/sql"
	"strings"
)

// escapable is the set CommonMark lets a backslash escape: ASCII punctuation
// and nothing else. A backslash before anything outside it - a letter, a
// space, a multi-byte rune - is a literal backslash and stays.
const escapable = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"

// Unescape removes the backslashes a Markdown serializer adds so that text can
// be searched for the way it was typed.
//
// A WYSIWYG editor writes `store\_Open` where the typist wrote `store_Open`:
// correct Markdown, and invisible on screen, but `content LIKE '%store_Open%'`
// stops matching. Rather than fight whichever serializer is in use - every one
// of them escapes something - the store keeps a plain copy of the text and
// searches that.
//
// It is deliberately not a Markdown parser. It undoes character escapes and
// leaves every other construct alone, so `# heading` and `[a](b)` come through
// intact and a search for them still works.
func Unescape(md string) string {
	if !strings.ContainsRune(md, '\\') {
		// The common case, and everything the terminal writes.
		return md
	}
	var b strings.Builder
	b.Grow(len(md))
	for i := 0; i < len(md); i++ {
		if md[i] == '\\' && i+1 < len(md) && strings.IndexByte(escapable, md[i+1]) >= 0 {
			i++ // skip the backslash, write what it was protecting
		}
		b.WriteByte(md[i])
	}
	return b.String()
}

// backfillSearchText fills the searchable copy for notes written before the
// column existed. It runs once, immediately after the column is added, so the
// cost lands on one startup rather than on every search.
func backfillSearchText(db *sql.DB) error {
	rows, err := db.Query(`SELECT id, content FROM notes`)
	if err != nil {
		return err
	}
	type row struct{ id, content string }
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.content); err != nil {
			rows.Close()
			return err
		}
		all = append(all, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	// One transaction: a half-filled column would silently hide notes from
	// search, and there is no later pass to notice.
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`UPDATE notes SET search_text = ? WHERE id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, r := range all {
		if _, err := stmt.Exec(Unescape(r.content), r.id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
