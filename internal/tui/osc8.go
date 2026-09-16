package tui

import (
	"fmt"
	"strings"
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

// linkifyRendered turns tagged link text into clickable hyperlinks, and does
// the same for URLs written out in full. targets holds the destinations in the
// order their links appear, which is the order the markers appear too.
func linkifyRendered(rendered string, targets []Target) string {
	out := linkifyBareURLs(rendered)

	var b strings.Builder
	b.Grow(len(out) + 64*len(targets))

	rest := out
	for i := 0; ; i++ {
		start := strings.Index(rest, linkOpenMarker)
		if start < 0 {
			break
		}
		end := strings.Index(rest[start:], linkCloseMarker)
		if end < 0 {
			break // unbalanced: leave the remainder alone
		}
		end += start

		b.WriteString(rest[:start])
		text := rest[start+len(linkOpenMarker) : end]

		if i < len(targets) && targets[i].clickable() {
			b.WriteString(hyperlink(targets[i].hyperlinkURL(), text, i+1))
		} else {
			b.WriteString(text) // an anchor, or a link we have no target for
		}
		rest = rest[end+len(linkCloseMarker):]
	}
	b.WriteString(rest)

	return stripMarkers(b.String())
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
