package tui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

const typed = "This is a deliberately long single line that should keep going well past the width of the window so we can see whether the editor wraps it onto the next row or hides the rest of it."

func TestEditorWrapsWhatYouType(t *testing.T) {
	m, st := newTestModel(t)
	if _, err := st.Create("Typing", "Typing\n"); err != nil {
		t.Fatal(err)
	}
	m = press(m, m.reload()())
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 40})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter}) // into the editor
	if m.mode != modeEdit {
		t.Fatalf("mode = %v, want modeEdit", m.mode)
	}
	m.body.SetValue(typed)

	out := stripEscapes(m.editView())
	t.Logf("widest line: %d (window 100)", widest(out))
	if w := widest(out); w > 100 {
		t.Errorf("a line is %d columns in a 100-column window", w)
	}
	if !strings.Contains(strings.Join(strings.Fields(out), " "), "hides the rest of it") {
		t.Errorf("the end of the typed line is not on screen:\n%s", out)
	}
}

// The wrap the editor shows is visual only: what gets saved is still the one
// long line you typed, exactly as a terminal behaves.
func TestEditorWrapDoesNotAlterWhatYouTyped(t *testing.T) {
	m, st := newTestModel(t)
	if _, err := st.Create("Typing", "Typing\n"); err != nil {
		t.Fatal(err)
	}
	m = press(m, m.reload()())
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 40})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})
	m.body.SetValue(typed)
	_ = m.editView() // draw it, wrapping and all

	got := m.body.Value()
	if strings.Count(got, "\n") != 0 {
		t.Errorf("the editor put %d newline(s) into the text:\n%q", strings.Count(got, "\n"), got)
	}
	if got != typed {
		t.Errorf("text changed:\n got %q\nwant %q", got, typed)
	}
}
