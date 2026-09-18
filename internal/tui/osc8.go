package tui

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Terminals show link text and hide the destination behind an OSC 8 escape,
// which is how the preview makes a link clickable. The renderer knows nothing
// about OSC 8, so link text is tagged with these markers while it renders and
// the escapes are wrapped around the tagged runs afterwards — once the text has
// already been measured and wrapped, so the invisible bytes cannot disturb the
// layout.
const (
	linkOpenMarker  = "\x01"
	linkCloseMarker = "\x02"
)

// hyperlink wraps text in the escape that makes it clickable. The id lets a
// terminal treat a link split across wrapped lines as one target.
func hyperlink(url, text string, id int) string {
	return fmt.Sprintf("\x1b]8;id=%d;%s\x1b\\%s\x1b]8;;\x1b\\", id, url, text)
}

func openable(url string) bool {
	return strings.HasPrefix(url, "http://") ||
		strings.HasPrefix(url, "https://") ||
		strings.HasPrefix(url, "mailto:")
}

// linkKey reduces text to the letters and digits in it, which is how a tagged
// run is matched to the target it belongs to.
//
// Everything else has to go, because the renderer is free to change it: it
// drops the emphasis marks it acted on, pads a code span with spaces, and word
// wrapping turns a space into a newline and an indent. The alphanumerics come
// through all of that unchanged, and in order.
//
// It skips escape sequences rather than reading through them, because a colour
// is written as "\x1b[38;5;35;1m" - digits, which would otherwise be taken for
// part of the text and stop any run from ever matching its target.
func linkKey(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); {
		if s[i] == 0x1b {
			i = pastEscape(s, i)
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
		i += size
	}
	return b.String()
}

// pastEscape returns the index just after the escape sequence starting at i,
// which is an ESC. Only the two forms that reach here are spelled out: CSI for
// colour, and OSC for a hyperlink a bare URL was already given.
func pastEscape(s string, i int) int {
	i++ // the ESC itself
	if i >= len(s) {
		return i
	}
	switch s[i] {
	case '[': // CSI: parameter bytes, then one byte in 0x40-0x7e ends it
		for i++; i < len(s) && (s[i] < 0x40 || s[i] > 0x7e); i++ {
		}
		return i + 1
	case ']': // OSC: runs until BEL or a string terminator
		for i++; i < len(s); i++ {
			if s[i] == 0x07 {
				return i + 1
			}
			if s[i] == 0x1b && i+1 < len(s) && s[i+1] == '\\' {
				return i + 2
			}
		}
		return i
	default:
		return i + 1
	}
}

// linkifyRendered turns tagged link text into clickable hyperlinks, and does
// the same for URLs written out in full. targets holds the destinations in the
// order their links appear, which is the order the tagged runs appear too.
//
// One target can own several runs. The renderer tags each separately styled
// piece of a link's text, so a name with an underscore in it - every
// `file_example.mov` - arrives in parts, and a link long enough to wrap
// arrives a line at a time. Counting one target per run was the bug: a single
// five-part filename handed the four links after it somebody else's
// destination, and left the note's last links with none at all.
//
// So the runs are read until they spell out the target, and if they ever fail
// to, the rest of the note is left alone. A link that does nothing is a much
// smaller wrong than a link that opens the wrong file.
func linkifyRendered(rendered string, targets []Target) string {
	out := linkifyBareURLs(rendered)

	var b strings.Builder
	b.Grow(len(out) + 64*len(targets))

	rest := out
	done := func() string {
		b.WriteString(rest)
		return stripMarkers(b.String())
	}

	for i := range targets {
		want := linkKey(targets[i].renderedText())
		got := ""
		for {
			start := strings.Index(rest, linkOpenMarker)
			if start < 0 {
				return done() // fewer runs than targets; nothing left to mark
			}
			end := strings.Index(rest[start:], linkCloseMarker)
			if end < 0 {
				return done() // unbalanced: leave the remainder alone
			}
			end += start

			text := rest[start+len(linkOpenMarker) : end]
			b.WriteString(rest[:start])
			if targets[i].clickable() {
				// Every run of one link carries the same id, so a terminal
				// treats a link split across lines as a single target.
				b.WriteString(hyperlink(targets[i].hyperlinkURL(), text, i+1))
			} else {
				b.WriteString(text) // an anchor, or a link we cannot open
			}
			rest = rest[end+len(linkCloseMarker):]

			got += linkKey(text)
			if got == want {
				break
			}
			if len(got) >= len(want) {
				return done() // drifted apart: mark nothing further
			}
		}
	}

	return done()
}

// linkifyBareURLs makes a URL that was written out in full clickable. Its text
// is the URL itself, so there is nothing to hide — only something to click.
func linkifyBareURLs(s string) string {
	return bareURL.ReplaceAllStringFunc(s, func(u string) string {
		trimmed := strings.TrimRight(u, ".,;:!?")
		suffix := u[len(trimmed):]
		if !openable(trimmed) {
			return u
		}
		return hyperlink(trimmed, trimmed, 0) + suffix
	})
}

func stripMarkers(s string) string {
	return strings.NewReplacer(linkOpenMarker, "", linkCloseMarker, "").Replace(s)
}

// tickMark is what sits inside a finished task's box: a green check, since a
// cross reads as cancelled rather than done. U+2713 is used in preference to
// the heavier ✔ or the ready-made ☑ because it is the one of the three that
// common monospace fonts actually carry — a missing glyph is substituted from
// another font, which draws it wider and swallows the space after the box.
// It is one printable cell, so ticked and unticked boxes align.
const tickMark = "\x1b[1;32m✓\x1b[0m"
