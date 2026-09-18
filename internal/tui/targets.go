package tui

import (
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
)

type targetKind int

const (
	targetLink targetKind = iota
	targetFile
	targetImage
)

// tag is the word that stands in front of an attachment's name, both in the
// preview and in the picker, so a row says what kind of thing it opens.
func (k targetKind) tag() string {
	switch k {
	case targetFile:
		return "file"
	case targetImage:
		return "img"
	default:
		return "link"
	}
}

// Target is one thing in a note that the system opener can be pointed at: a
// link, or a file attached to the note.
type Target struct {
	Label string // the text the reader sees, without any surrounding brackets
	Open  string // what the system opener is handed
	Kind  targetKind
}

// renderedText is the text the renderer draws for this target: the chip's tag
// and name, or a plain link's own text. linkifyRendered matches the runs the
// renderer tags against this, so it has to mirror what prepareForRender emits.
func (t Target) renderedText() string {
	if t.Kind == targetLink {
		return t.Label
	}
	return t.Kind.tag() + " " + t.Label
}

// hyperlinkURL is Open written so a terminal will accept it inside an OSC 8
// escape. An attachment resolves to a path on disk, which needs a scheme
// before a terminal will treat it as a link.
func (t Target) hyperlinkURL() string {
	if filepath.IsAbs(t.Open) {
		return (&url.URL{Scheme: "file", Path: t.Open}).String()
	}
	return t.Open
}

// clickable reports whether handing this target to a terminal is worth doing.
// Anchors and relative paths are not, everything the opener understands is.
func (t Target) clickable() bool {
	return filepath.IsAbs(t.Open) || openable(t.Open)
}

// storedName matches the name an attachment is saved under, so a link that
// merely starts with "attachments/" is not mistaken for one.
var storedName = regexp.MustCompile(`^[0-9a-f]{16}\.[a-z0-9]{1,8}$`)

// literal hides the characters the renderer would otherwise read as markup, so
// a filename is shown exactly as it is on disk. Without it a file called
// star*x*y.png loses its asterisks on the way to the screen, and one with
// backticks in its name has the middle of it set as code.
//
// Character references are used rather than backslashes because a backslash
// does not escape a tilde here - the strikethrough extension takes the tilde
// first, and the backslash is left on the screen. A reference is read before
// any of that and comes out as the one character it names.
//
// The ampersand has to go first, so that a file whose name really does contain
// "&#42;" keeps it. A replacer never rescans what it has just written, so the
// references below are safe from it.
//
// Brackets are left alone: they are already escaped where the note's markdown
// is written, in internal/attach.
var literal = strings.NewReplacer(
	"&", "&amp;",
	"*", "&#42;",
	"_", "&#95;",
	"~", "&#126;",
	"`", "&#96;",
).Replace

// prepareForRender rewrites a note for the renderer and returns the targets
// of every link the renderer will mark, in the order it will mark them.
//
// The two halves have to be produced together. The renderer tags link text as
// it renders, and the escapes are wrapped around those tags afterwards by
// position, so a target list built by a separate walk of the note drifts out
// of step the moment the two disagree about what counts as a link. Attachments
// are exactly such a disagreement: they are links in the note but chips in the
// preview.
func (m model) prepareForRender(md string) (string, []Target) {
	var targets []Target

	out := eachLineOutsideCode(md, func(line string) string {
		return inlineLink.ReplaceAllStringFunc(line, func(match string) string {
			parts := inlineLink.FindStringSubmatch(match)
			bracketed, dest := parts[1], parts[2]

			image := strings.HasPrefix(bracketed, "!")
			text := strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(bracketed, "!"), "["), "]")

			if base, ok := strings.CutPrefix(dest, "attachments/"); ok && storedName.MatchString(base) {
				// Drawing the image itself would need the kitty, iTerm2 or
				// sixel protocol, and none of the three is widely available,
				// so the preview names the file and opening hands it to the
				// system viewer.
				kind := targetFile
				if image {
					kind = targetImage
				}
				name := text
				if name == "" {
					name = base
				}
				targets = append(targets, Target{
					Label: name,
					Open:  m.resolveTarget(dest),
					Kind:  kind,
				})
				// A chip is written as a link, not as plain text, so that the
				// renderer tags it and it can be made clickable like any other.
				// The kind is spelled out in front of the name because a
				// terminal cannot draw the file to say what it is.
				return "[" + kind.tag() + " " + literal(name) + "](#)"
			}

			if image {
				// Left as an image so the renderer styles it as one. It is not
				// tagged, so it contributes no target.
				return bracketed + "(#)"
			}

			targets = append(targets, Target{Label: text, Open: dest, Kind: targetLink})
			return bracketed + "(#)"
		})
	})

	return out, targets
}
