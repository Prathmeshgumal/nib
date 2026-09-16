package tui

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/Prathmeshgumal/nib/internal/attach"
)

// A terminal has no drag-and-drop. Dragging a file onto the window makes the
// emulator paste the path as text, and that is the whole gesture: what arrives
// here is a bracketed paste that happens to name a file.
//
// Emulators disagree about how. Some paste a plain path, some a file:// URI,
// some percent-encode it, some escape spaces with a backslash, and some quote
// the whole thing. Dragging several files gives several paths separated by
// newlines or spaces.

// droppedPaths reports the existing files a pasted blob of text names, or nil
// if it does not name files.
//
// Nil is the safety property: an ordinary paste has to behave exactly as it
// always has, so anything less than "every part of this is a file that exists"
// is treated as text. That is also why it is all or nothing — importing the
// half of a paste that resolved would silently lose the other half.
func droppedPaths(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}

	// One path first, always: a filename may contain spaces, and splitting
	// before trying the whole thing would tear it in two.
	if p, ok := existingFile(text); ok {
		return []string{p}
	}

	for _, split := range []func(string) []string{splitLines, strings.Fields} {
		parts := split(text)
		if len(parts) < 2 {
			continue
		}
		out := make([]string, 0, len(parts))
		for _, part := range parts {
			p, ok := existingFile(part)
			if !ok {
				out = nil
				break
			}
			out = append(out, p)
		}
		if out != nil {
			return out
		}
	}
	return nil
}

func splitLines(s string) []string {
	var out []string
	for _, line := range strings.Split(s, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			out = append(out, line)
		}
	}
	return out
}

// existingFile resolves one piece of a paste to a readable file, trying each
// spelling an emulator might have used.
func existingFile(s string) (string, bool) {
	for _, candidate := range spellings(s) {
		info, err := os.Stat(candidate)
		// A directory is not an attachment, and neither is a device node.
		if err == nil && info.Mode().IsRegular() {
			return candidate, true
		}
	}
	return "", false
}

// spellings lists the paths one dropped string might mean, most literal first.
func spellings(s string) []string {
	s = unquote(strings.TrimSpace(s))
	if s == "" {
		return nil
	}

	if rest, ok := strings.CutPrefix(s, "file://"); ok {
		// Some emulators write file://localhost/path rather than file:///path.
		rest = strings.TrimPrefix(rest, "localhost")
		decoded, err := url.PathUnescape(rest)
		if err != nil {
			decoded = rest
		}
		return []string{expandHome(decoded)}
	}

	// The literal text first, then with backslash escapes undone: a filename
	// may legitimately contain a backslash, so the escaped reading is only a
	// fallback.
	out := []string{expandHome(s)}
	if unescaped := unescapeSpaces(s); unescaped != s {
		out = append(out, expandHome(unescaped))
	}
	return out
}

func unquote(s string) string {
	if len(s) >= 2 {
		if q := s[0]; (q == '\'' || q == '"') && s[len(s)-1] == q {
			return s[1 : len(s)-1]
		}
	}
	return s
}

// unescapeSpaces undoes the shell-style escaping several emulators apply.
func unescapeSpaces(s string) string {
	return strings.NewReplacer(`\ `, " ", `\(`, "(", `\)`, ")", `\&`, "&", `\'`, "'").Replace(s)
}

func expandHome(s string) string {
	if !strings.HasPrefix(s, "~/") {
		return filepath.Clean(s)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Clean(s)
	}
	return filepath.Join(home, s[2:])
}

// attachDropped stores the dropped files and writes a reference to each into
// the note being edited.
//
// It runs in the handler rather than as a command: copying a local file takes
// milliseconds, and threading the result back through a message would buy
// nothing but a chance for the cursor to have moved in between.
func (m *model) attachDropped(paths []string) tea.Cmd {
	at := m.st.Attachments()

	var lines []string
	var failure error
	for _, path := range paths {
		ref, err := addFile(at, path)
		if err != nil {
			failure = err
			continue
		}
		lines = append(lines, ref.Markdown())
	}

	if len(lines) == 0 {
		if failure != nil {
			return flash("Could not attach it: " + failure.Error())
		}
		return flash("Could not attach it")
	}

	// Each reference gets a line to itself: an image wedged into a paragraph
	// renders as part of that paragraph.
	text := strings.Join(lines, "\n")
	if _, col := m.currentLine(); col > 0 {
		text = "\n" + text
	}
	m.body.InsertString(text + "\n")

	switch {
	case failure != nil:
		return flash(plural(len(lines), "file") + " attached, one could not be read")
	case len(lines) == 1:
		return flash("Attached " + filepath.Base(paths[0]))
	default:
		return flash("Attached " + plural(len(lines), "files"))
	}
}

func addFile(at *attach.Store, path string) (attach.Ref, error) {
	f, err := os.Open(path)
	if err != nil {
		return attach.Ref{}, err
	}
	defer f.Close()
	return at.Add(filepath.Base(path), f)
}

func plural(n int, word string) string {
	return fmt.Sprintf("%d %s", n, word)
}

// attachmentReference matches an attachment link exactly as attach.Ref.Markdown
// writes it, capturing the leading "!" for an image, the link text, and the
// name on disk.
var attachmentReference = regexp.MustCompile(`(!?)\[([^\]]*)\]\(attachments/([0-9a-f]{16}\.[a-z0-9]{1,8})\)`)

// attachmentChips rewrites an attachment reference into something a terminal
// can actually show.
//
// Drawing the image would need the kitty, iTerm2 or sixel protocol, and none
// of the three is widely available, so the preview names the file instead and
// "o" hands it to the system viewer.
func attachmentChips(md string) string {
	return eachLineOutsideCode(md, func(line string) string {
		return attachmentReference.ReplaceAllStringFunc(line, func(m string) string {
			parts := attachmentReference.FindStringSubmatch(m)
			kind := "file"
			if parts[1] == "!" {
				kind = "img"
			}
			name := parts[2]
			if name == "" {
				name = parts[3]
			}
			return "[" + kind + " " + name + "]"
		})
	})
}

// resolveTarget turns a link destination into something worth handing to the
// system opener. An attachment is a relative path inside a directory only this
// program knows about; everything else is passed through untouched.
func (m model) resolveTarget(target string) string {
	base, ok := strings.CutPrefix(target, "attachments/")
	if !ok || m.st == nil {
		return target
	}
	return filepath.Join(m.st.Attachments().Dir(), base)
}
