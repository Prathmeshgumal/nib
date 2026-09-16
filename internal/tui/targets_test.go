package tui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// The renderer tags link text as it renders and the escapes are wrapped around
// those tags by position afterwards, so one target must exist for each tag. An
// attachment is the case that broke this: it is a link in the note but a chip
// in the preview, and while chips were plain text every link that followed one
// was paired with the wrong destination.
func TestEveryTaggedLinkHasATarget(t *testing.T) {
	var m model
	for _, md := range []string{
		"[a](https://a.test)",
		"[section](#heading)",
		"![alt](https://example.com/x.png)",
		"![pic](attachments/1556d7a7cbcc1ec8.pdf)",
		"[alpha](https://alpha.test) [doc](attachments/1556d7a7cbcc1ec8.pdf) [omega](https://omega.test)",
		"![shot](attachments/4b0cbf08821cb6a1.png) then [after](https://after.test)",
	} {
		prepared, targets := m.prepareForRender(md)
		out := renderWithMarkers(t, separateListGroups(prepared))
		if got := strings.Count(out, linkOpenMarker); got != len(targets) {
			t.Errorf("%q: %d tagged links but %d targets", md, got, len(targets))
		}
	}
}

// The bug the alignment check above guards against, stated as the reader sees
// it: a link written after an attachment stops being clickable.
func TestALinkAfterAnAttachmentStaysClickable(t *testing.T) {
	out := renderPreviewBody(t,
		"[alpha](https://alpha.test) then [doc](attachments/1556d7a7cbcc1ec8.pdf) then [omega](https://omega.test)", "x")

	for _, want := range []string{"https://alpha.test", "https://omega.test"} {
		if !strings.Contains(out, ";"+want+"\x1b\\") {
			t.Errorf("%s was not made clickable:\n%q", want, out)
		}
	}
}

func TestAnAttachmentBecomesAClickableFileLink(t *testing.T) {
	m, st := newTestModel(t)
	ref, err := st.Attachments().Add("report.pdf", strings.NewReader("%PDF-1.4\n"))
	if err != nil {
		t.Fatal(err)
	}
	md := "see [report.pdf](attachments/" + ref.Base() + ")"

	prepared, targets := m.prepareForRender(md)
	out := linkifyRendered(renderWithMarkers(t, separateListGroups(prepared)), targets)

	if !strings.Contains(out, "\x1b]8;id=1;file://") {
		t.Errorf("the attachment did not become a hyperlink:\n%q", out)
	}
	if !strings.Contains(out, ref.Base()) {
		t.Errorf("the hyperlink does not point at the stored file:\n%q", out)
	}
	// The path is for the terminal, not for the reader.
	if strings.Contains(stripEscapes(out), "file://") {
		t.Errorf("the path leaked into visible text:\n%q", stripEscapes(out))
	}
	if !strings.Contains(stripEscapes(out), "file report.pdf") {
		t.Errorf("the chip is missing from the preview:\n%q", stripEscapes(out))
	}
}

func TestAPathWithSpacesSurvivesTheFileURL(t *testing.T) {
	got := Target{Open: "/home/a b/My Notes/x.pdf"}.hyperlinkURL()
	want := "file:///home/a%20b/My%20Notes/x.pdf"
	if got != want {
		t.Errorf("hyperlinkURL = %q, want %q", got, want)
	}
}

func TestOnlyAbsolutePathsAndURLsAreClickable(t *testing.T) {
	for _, tc := range []struct {
		open string
		want bool
	}{
		{"https://example.com", true},
		{"http://example.com", true},
		{"mailto:someone@example.com", true},
		{"/home/user/file.pdf", true},
		{"#heading", false},
		{"attachments/1556d7a7cbcc1ec8.pdf", false},
		{"", false},
	} {
		if got := (Target{Open: tc.open}).clickable(); got != tc.want {
			t.Errorf("clickable(%q) = %v, want %v", tc.open, got, tc.want)
		}
	}
}

func TestOneTargetOpensWithoutAsking(t *testing.T) {
	// Nothing is launched: with no PATH the opener finds no command and
	// returns, which leaves the mode change as the thing under test.
	t.Setenv("PATH", "")

	m, st := newTestModel(t)
	if _, err := st.Create("Only one", "see [docs](https://example.com)"); err != nil {
		t.Fatal(err)
	}
	m = press(m, m.reload()())

	m = press(m, key('o'))
	if m.mode != modeList {
		t.Errorf("mode = %v, want the note view: one target needs no picker", m.mode)
	}
}

func TestSeveralTargetsOpenThePicker(t *testing.T) {
	t.Setenv("PATH", "")

	m, st := newTestModel(t)
	if _, err := st.Create("Several", "[a](https://a.test) and [b](https://b.test)"); err != nil {
		t.Fatal(err)
	}
	m = press(m, m.reload()())

	m = press(m, key('o'))
	if m.mode != modePick {
		t.Fatalf("mode = %v, want modePick", m.mode)
	}
	if len(m.picks) != 2 {
		t.Fatalf("picks = %v, want two", m.picks)
	}
	if m.pickCursor != 0 {
		t.Errorf("pickCursor = %d, want the first row", m.pickCursor)
	}

	m = press(m, key('j'))
	if m.pickCursor != 1 {
		t.Errorf("pickCursor = %d, want the second row after j", m.pickCursor)
	}
	// The cursor stops at the end rather than wrapping.
	m = press(m, key('j'))
	if m.pickCursor != 1 {
		t.Errorf("pickCursor = %d, want it to stop at the last row", m.pickCursor)
	}
	m = press(m, key('k'))
	if m.pickCursor != 0 {
		t.Errorf("pickCursor = %d, want the first row after k", m.pickCursor)
	}
	m = press(m, key('k'))
	if m.pickCursor != 0 {
		t.Errorf("pickCursor = %d, want it to stop at the first row", m.pickCursor)
	}
}

func TestEscapeClosesThePickerWithoutOpening(t *testing.T) {
	t.Setenv("PATH", "")

	m, st := newTestModel(t)
	if _, err := st.Create("Several", "[a](https://a.test) and [b](https://b.test)"); err != nil {
		t.Fatal(err)
	}
	m = press(m, m.reload()())
	m = press(m, key('o'))

	m = press(m, tea.KeyMsg{Type: tea.KeyEsc})
	if m.mode != modeList {
		t.Errorf("mode = %v, want the note view", m.mode)
	}
	if m.picks != nil {
		t.Errorf("picks = %v, want them cleared", m.picks)
	}
}

func TestANumberOpensThatRow(t *testing.T) {
	t.Setenv("PATH", "")

	m, st := newTestModel(t)
	if _, err := st.Create("Several", "[a](https://a.test) and [b](https://b.test)"); err != nil {
		t.Fatal(err)
	}
	m = press(m, m.reload()())
	m = press(m, key('o'))

	m = press(m, key('2'))
	if m.mode != modeList {
		t.Errorf("mode = %v, want the picker closed", m.mode)
	}

	// A number past the end is not a row, so it does nothing.
	m = press(m, key('o'))
	m = press(m, key('9'))
	if m.mode != modePick {
		t.Errorf("mode = %v, want the picker still open", m.mode)
	}
}

func TestANoteWithNothingToOpenSaysSo(t *testing.T) {
	t.Setenv("PATH", "")

	m, st := newTestModel(t)
	if _, err := st.Create("Bare", "no links here at all"); err != nil {
		t.Fatal(err)
	}
	m = press(m, m.reload()())

	m = press(m, key('o'))
	if m.mode != modeList {
		t.Errorf("mode = %v, want the note view", m.mode)
	}
}

func TestMiddleTruncateKeepsBothEnds(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"short.pdf", "short.pdf"},
		{"averyveryverylongfilename.pdf", "averyve…me.pdf"},
	} {
		if got := middleTruncate(tc.in, 14); got != tc.want {
			t.Errorf("middleTruncate(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
	// The extension is the part worth keeping, so it survives.
	got := middleTruncate("System Design Interview by Alex Xu (1).pdf", 20)
	if !strings.HasSuffix(got, ".pdf") {
		t.Errorf("middleTruncate = %q, want it to keep the extension", got)
	}
	if len([]rune(got)) != 20 {
		t.Errorf("middleTruncate = %q, %d runes, want 20", got, len([]rune(got)))
	}
}

// Reaching the picker with nothing in it should not be possible. If it ever
// becomes possible, it must not take the program down with it.
func TestAnEmptyPickerCannotPanic(t *testing.T) {
	m, _ := newTestModel(t)
	m.mode = modePick
	m.picks = nil

	for _, k := range []rune{'j', 'k', 'G', 'g', '1'} {
		m = press(m, key(k))
	}
	// Enter is the one that would index into the empty list.
	m.mode = modePick
	m.picks = nil
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})
	if m.mode != modeList {
		t.Errorf("mode = %v, want it to fall back to the note view", m.mode)
	}
}
