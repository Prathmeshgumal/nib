package tui

import (
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/Prathmeshgumal/nib/internal/store"
)

func benchModel(b *testing.B) model {
	b.Helper()
	st, err := store.Open(filepath.Join(b.TempDir(), "bench.db"))
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { st.Close() })
	body := "# Heading\n\nSome **bold** text with a [link](https://example.com).\n\n" +
		"- one\n- two\n- three\n\n> a quote\n\n```go\nfmt.Println(\"hi\")\n```\n"
	for _, t := range []string{"alpha", "beta", "gamma"} {
		if _, err := st.Create(t, body); err != nil {
			b.Fatal(err)
		}
	}
	m := New(st)
	next, _ := m.Update(tea.WindowSizeMsg{Width: 118, Height: 55})
	return next.(model)
}

// BenchmarkCursorMove measures one keypress of navigation, which is what the
// user feels when holding down an arrow key.
func BenchmarkCursorMove(b *testing.B) {
	m := benchModel(b)
	down := tea.KeyMsg{Type: tea.KeyDown}
	up := tea.KeyMsg{Type: tea.KeyUp}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if i%2 == 0 {
			m = press(m, down)
		} else {
			m = press(m, up)
		}
	}
}

func BenchmarkRenderPreview(b *testing.B) {
	m := benchModel(b)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.renderPreview()
	}
}

// benchTyping measures one keystroke in the editor.
//
// Autosave compares the draft against itself on every event to decide whether
// a write is due, which is a pass over the whole note. This is here to keep
// that honest: a note is allowed to be as long as someone wants, and typing
// into a long one must not start to drag.
func benchTyping(b *testing.B, paragraphs int) {
	b.Helper()
	st, err := store.Open(filepath.Join(b.TempDir(), "typing.db"))
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { st.Close() })
	long := strings.Repeat("Some ordinary prose in a note that has grown long.\n\n", paragraphs)
	if _, err := st.Create("Long", long); err != nil {
		b.Fatal(err)
	}

	m := New(st)
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	notes, err := st.List("")
	if err != nil {
		b.Fatal(err)
	}
	m = press(m, reloadedMsg{notes: notes})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m = press(m, key('x'))
	}
}

func BenchmarkTypingShortNote(b *testing.B) { benchTyping(b, 5) }
func BenchmarkTypingLongNote(b *testing.B)  { benchTyping(b, 500) }
