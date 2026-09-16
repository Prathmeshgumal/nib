package tui

import (
	"strings"
	"testing"
)

// renderPreviewBody mirrors what the preview does, so the tests exercise the
// same path the reader sees.
func renderPreviewBody(t *testing.T, content, title string) string {
	t.Helper()
	var m model
	body := stripDerivedTitle(content, title)
	prepared, targets := m.prepareForRender(body)
	out := renderWithMarkers(t, separateListGroups(prepared))
	return linkifyRendered(out, targets)
}

func TestLinkTextBecomesClickable(t *testing.T) {
	out := renderPreviewBody(t, "Solve 10 [DSA questions](https://codehelp.in/courses).", "x")

	if !strings.Contains(out, "\x1b]8;id=1;https://codehelp.in/courses\x1b\\") {
		t.Errorf("no hyperlink escape opening the URL:\n%q", out)
	}
	if !strings.Contains(out, "\x1b]8;;\x1b\\") {
		t.Errorf("hyperlink never closed:\n%q", out)
	}
	if !strings.Contains(out, "DSA questions") {
		t.Errorf("link text missing:\n%q", out)
	}
	// The URL must not be shown as visible text.
	if strings.Contains(stripEscapes(out), "codehelp.in") {
		t.Errorf("URL is visible in the text:\n%q", stripEscapes(out))
	}
	if strings.ContainsAny(out, linkOpenMarker+linkCloseMarker) {
		t.Errorf("internal markers leaked into the output:\n%q", out)
	}
}

func TestSeveralLinksGetTheirOwnTargets(t *testing.T) {
	out := renderPreviewBody(t, "[one](https://one.test) then [two](https://two.test)", "x")

	for i, want := range []string{"https://one.test", "https://two.test"} {
		if !strings.Contains(out, "\x1b]8;id="+string(rune('1'+i))+";"+want+"\x1b\\") {
			t.Errorf("link %d did not get %s:\n%q", i+1, want, out)
		}
	}
}

func TestBareURLIsClickableAndStillVisible(t *testing.T) {
	out := renderPreviewBody(t, "see https://bare.test for details", "x")

	if !strings.Contains(out, "\x1b]8;id=0;https://bare.test\x1b\\") {
		t.Errorf("bare URL was not made clickable:\n%q", out)
	}
	if !strings.Contains(stripEscapes(out), "https://bare.test") {
		t.Errorf("bare URL should stay visible, it is its own text:\n%q", stripEscapes(out))
	}
}

func TestAnchorLinksAreNotClickable(t *testing.T) {
	out := renderPreviewBody(t, "jump to [a section](#heading)", "x")

	if strings.Contains(out, "\x1b]8;") {
		t.Errorf("an anchor should not become a hyperlink:\n%q", out)
	}
	if !strings.Contains(stripEscapes(out), "a section") {
		t.Errorf("link text missing:\n%q", stripEscapes(out))
	}
	if strings.ContainsAny(out, linkOpenMarker+linkCloseMarker) {
		t.Errorf("markers leaked:\n%q", out)
	}
}

func TestImagesDoNotShiftLinkTargets(t *testing.T) {
	// An image before a link must not consume the link's destination.
	out := renderPreviewBody(t, "![pic](https://img.test/a.png) and [real](https://real.test)", "x")

	if !strings.Contains(out, "https://real.test") {
		t.Errorf("the link lost its destination:\n%q", out)
	}
	if strings.Contains(out, "\x1b]8;id=1;https://img.test") {
		t.Errorf("the image's URL was used for the link:\n%q", out)
	}
}

func TestTargetsSkipImagesSoLinksKeepTheirs(t *testing.T) {
	var m model
	_, got := m.prepareForRender("[a](https://a.test) ![i](https://i.test) [b](https://b.test)")
	want := []string{"https://a.test", "https://b.test"}
	if len(got) != len(want) || got[0].Open != want[0] || got[1].Open != want[1] {
		t.Errorf("got %v, want %v", got, want)
	}
}

// Markdown inside a code block stays literal — the link syntax is shown as
// typed rather than turned into a label. The URL is visible there, so leaving
// it clickable costs nothing and hides nothing.
func TestCodeBlocksKeepTheirLiteralMarkdown(t *testing.T) {
	out := stripEscapes(renderPreviewBody(t, "```\n[a](https://incode.test)\n```", "x"))
	if !strings.Contains(out, "[a](https://incode.test)") {
		t.Errorf("code block did not keep its literal text:\n%q", out)
	}
}

func stripEscapes(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		if s[i] == 0x1b {
			// Skip CSI (ESC [ ... letter) and OSC (ESC ] ... ESC \) sequences.
			if i+1 < len(s) && s[i+1] == '[' {
				j := i + 2
				for j < len(s) && !((s[j] >= 'a' && s[j] <= 'z') || (s[j] >= 'A' && s[j] <= 'Z')) {
					j++
				}
				i = j + 1
				continue
			}
			if i+1 < len(s) && s[i+1] == ']' {
				j := strings.Index(s[i:], "\x1b\\")
				if j < 0 {
					break
				}
				i += j + 2
				continue
			}
			i++
			continue
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}
