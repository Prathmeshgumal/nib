package tui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// A paragraph long enough that the wrapping width shows up in the output.
const longPara = "A database allows reads and writes for n number of users. What happens when the n number of users is too high, the database becomes the bottleneck and everything slows down considerably."

// widest is the longest visible line, which is what the wrapping width sets.
func widest(s string) int {
	w := 0
	for _, line := range strings.Split(stripEscapes(s), "\n") {
		if n := len([]rune(strings.TrimRight(line, " "))); n > w {
			w = n
		}
	}
	return w
}

// Bug 1: the preview is wrapped for whatever width was current the first time
// a note rendered, and a later resize does not widen it.
func TestPreviewRewrapsWhenTheWindowGrows(t *testing.T) {
	m, st := newTestModel(t)
	if _, err := st.Create("Wide", "Wide\n\n"+longPara+"\n"); err != nil {
		t.Fatal(err)
	}
	m = press(m, m.reload()())

	// The narrow first frame, as happens before the real size arrives.
	m = press(m, tea.WindowSizeMsg{Width: 80, Height: 44})
	narrow := widest(m.preview.View())

	// Then the terminal's real size.
	m = press(m, tea.WindowSizeMsg{Width: 200, Height: 44})
	wide := widest(m.preview.View())

	t.Logf("narrow=%d wide=%d", narrow, wide)
	if wide <= narrow {
		t.Errorf("preview did not rewrap: widest line %d at 80 cols, %d at 200 cols", narrow, wide)
	}
	if wide < 100 {
		t.Errorf("widest line is %d, want it to use the 200-column window", wide)
	}
}

// Bug 2: the source view clips long lines instead of wrapping them.
func TestRawViewWrapsLongLines(t *testing.T) {
	m, st := newTestModel(t)
	if _, err := st.Create("Wide", "Wide\n\n"+longPara+"\n"); err != nil {
		t.Fatal(err)
	}
	m = press(m, m.reload()())
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 44})

	m = press(m, key('R'))
	if m.mode != modeRaw {
		t.Fatalf("mode = %v, want modeRaw", m.mode)
	}
	out := m.rawView.View()
	if w := widest(out); w > 100 {
		t.Errorf("a line is %d columns wide in a 100-column window", w)
	}
	if !strings.Contains(stripEscapes(out), "bottleneck") {
		t.Errorf("the end of the long line never appears, so it was clipped:\n%s", stripEscapes(out))
	}
}

// Moving between notes must still come out of the cache. The width check now
// runs before the lookup, so it has to stay cheap enough not to re-render.
func TestARepeatRenderStillComesFromTheCache(t *testing.T) {
	m, st := newTestModel(t)
	if _, err := st.Create("Cached", "Cached\n\n"+longPara+"\n"); err != nil {
		t.Fatal(err)
	}
	m = press(m, m.reload()())
	m = press(m, tea.WindowSizeMsg{Width: 120, Height: 44})

	n := m.selected()
	key := n.ID + "\x00" + n.UpdatedAt
	first, ok := m.rendered[key]
	if !ok {
		t.Fatal("nothing was cached")
	}

	// Re-rendering at the same width must reuse it, not rebuild it.
	before := m.renderer
	m.renderPreview()
	if m.renderer != before {
		t.Error("the renderer was rebuilt at an unchanged width")
	}
	if again := m.rendered[key]; again != first {
		t.Error("the cached render was replaced at an unchanged width")
	}
}
