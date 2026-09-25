package store

import "strings"

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
