package tui

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/Prathmeshgumal/nib/internal/attach"
)

func touch(t *testing.T, dir, name string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestDroppedPathsUnderstandsTheEmulators(t *testing.T) {
	dir := t.TempDir()
	plain := touch(t, dir, "shot.png")
	spaced := touch(t, dir, "holiday photo.png")

	for _, c := range []struct {
		what string
		text string
		want []string
	}{
		{"a plain path", plain, []string{plain}},
		{"a file URI", "file://" + plain, []string{plain}},
		{"a percent-encoded URI", "file://" + dir + "/holiday%20photo.png", []string{spaced}},
		{"a quoted path", `'` + spaced + `'`, []string{spaced}},
		{"a double-quoted path", `"` + spaced + `"`, []string{spaced}},
		{"a backslash-escaped space", dir + `/holiday\ photo.png`, []string{spaced}},
		{"an unescaped space", spaced, []string{spaced}},
		{"trailing whitespace", plain + "\n", []string{plain}},
		{"two files on two lines", plain + "\n" + spaced, []string{plain, spaced}},
	} {
		if got := droppedPaths(c.text); !slices.Equal(got, c.want) {
			t.Errorf("%s: droppedPaths(%q) = %v, want %v", c.what, c.text, got, c.want)
		}
	}
}

func TestDroppedPathsIgnoresOrdinaryText(t *testing.T) {
	dir := t.TempDir()
	real := touch(t, dir, "real.png")

	for _, text := range []string{
		"",
		"   ",
		"just some pasted prose",
		"https://example.com/photo.png",
		filepath.Join(dir, "does-not-exist.png"),
		// One real and one imaginary: all or nothing, or half a paste is lost.
		real + "\n" + filepath.Join(dir, "missing.png"),
		dir, // a directory is not a file
	} {
		if got := droppedPaths(text); got != nil {
			t.Errorf("droppedPaths(%q) = %v, want nil so it pastes as text", text, got)
		}
	}
}

func TestDroppedPathsExpandsHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		t.Skip("no home directory")
	}
	f, err := os.CreateTemp(home, "nib-drop-*.png")
	if err != nil {
		t.Skip("cannot write to the home directory")
	}
	defer os.Remove(f.Name())
	f.Close()

	text := "~/" + filepath.Base(f.Name())
	if got := droppedPaths(text); !slices.Equal(got, []string{f.Name()}) {
		t.Errorf("droppedPaths(%q) = %v, want [%s]", text, got, f.Name())
	}
}

// editing returns a model sitting in a new note, the way pressing "n" leaves
// it: the widgets are focused, which setting the mode by hand does not do.
func editing(t *testing.T) model {
	t.Helper()
	m, _ := newTestModel(t)
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, key('n'))
	if m.mode != modeEdit {
		t.Fatalf("mode = %v, want modeEdit after pressing n", m.mode)
	}
	return m
}

func TestPastingAPathAttachesTheFile(t *testing.T) {
	m := editing(t)

	dir := t.TempDir()
	png := filepath.Join(dir, "shot.png")
	if err := os.WriteFile(png, []byte("\x89PNG\r\n\x1a\npretend"), 0o600); err != nil {
		t.Fatal(err)
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(png), Paste: true})
	got := updated.(model).body.Value()

	if !strings.Contains(got, "](attachments/") {
		t.Errorf("body = %q, want an attachment reference", got)
	}
	if strings.Contains(got, png) {
		t.Errorf("body = %q, want the path replaced, not typed", got)
	}
	if ids := attach.Refs(got); len(ids) != 1 {
		t.Errorf("Refs(%q) = %v, want exactly one", got, ids)
	}
}

func TestPastingTextStillPastesText(t *testing.T) {
	m := editing(t)

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("just words"), Paste: true})
	if got := updated.(model).body.Value(); !strings.Contains(got, "just words") {
		t.Errorf("body = %q, want the text pasted unchanged", got)
	}
}

func TestPastingIntoTheTitleIsNotAnImport(t *testing.T) {
	// The title is one line of plain text; an image reference there is noise.
	m := editing(t)
	m.focusTitle = true
	m.title.Focus()
	m.body.Blur()

	dir := t.TempDir()
	png := filepath.Join(dir, "shot.png")
	if err := os.WriteFile(png, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(png), Paste: true})
	if got := updated.(model).title.Value(); !strings.Contains(got, png) {
		t.Errorf("title = %q, want the path pasted as text", got)
	}
}
