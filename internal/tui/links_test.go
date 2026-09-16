package tui

import (
	"reflect"
	"strings"
	"testing"
)

// The renderer is handed markdown whose destinations have been replaced with a
// bare anchor, so the preview shows link text the way a browser does.
func TestPreparedMarkdownHidesDestinations(t *testing.T) {
	for _, tc := range []struct{ name, in, want string }{
		{
			name: "inline link keeps its text",
			in:   "Solve 10 [DSA questions](https://codehelp.in/courses).",
			want: "Solve 10 [DSA questions](#).",
		},
		{
			name: "link with a title attribute",
			in:   `see [docs](https://example.com "The docs")`,
			want: "see [docs](#)",
		},
		{
			name: "several links on one line",
			in:   "[a](https://a.com) and [b](https://b.com)",
			want: "[a](#) and [b](#)",
		},
		{
			name: "images are treated the same way",
			in:   "![alt](https://example.com/x.png)",
			want: "![alt](#)",
		},
		{
			name: "a bare URL is left alone, it has no text to hide behind",
			in:   "see https://example.com for details",
			want: "see https://example.com for details",
		},
		{
			name: "links inside a code fence are untouched",
			in:   "```\n[a](https://a.com)\n```",
			want: "```\n[a](https://a.com)\n```",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var m model
			if got, _ := m.prepareForRender(tc.in); got != tc.want {
				t.Errorf("got  %q\nwant %q", got, tc.want)
			}
		})
	}
}

func TestOpenableInANote(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   string
		want []string
	}{
		{
			name: "inline links in order",
			in:   "[first](https://one.com) then [second](https://two.com)",
			want: []string{"https://one.com", "https://two.com"},
		},
		{
			name: "bare URLs are included",
			in:   "see https://bare.com and [named](https://named.com)",
			want: []string{"https://named.com", "https://bare.com"},
		},
		{
			name: "trailing punctuation is trimmed",
			in:   "go to https://example.com.",
			want: []string{"https://example.com"},
		},
		{
			name: "duplicates appear once",
			in:   "[a](https://same.com) and [b](https://same.com)",
			want: []string{"https://same.com"},
		},
		{
			name: "anchors are not openable links",
			in:   "[section](#heading)",
			want: nil,
		},
		{
			name: "code blocks are ignored",
			in:   "```\nhttps://incode.com\n```",
			want: nil,
		},
		{
			name: "a note with no links",
			in:   "- [ ] just a task",
			want: nil,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var m model
			var got []string
			for _, target := range m.openableIn(tc.in) {
				got = append(got, target.Open)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}

// The URL must not survive into what the reader sees.
func TestRenderedPreviewHasNoURL(t *testing.T) {
	var m model
	md := "- [x] Solve 10 [DSA questions](https://www.codehelp.in/courses).\n"
	prepared, _ := m.prepareForRender(md)
	out := renderToPlain(t, prepared)
	if strings.Contains(out, "codehelp.in") {
		t.Errorf("URL leaked into the preview:\n%s", out)
	}
	if !strings.Contains(out, "DSA questions") {
		t.Errorf("link text missing from the preview:\n%s", out)
	}
	// No gap left where the URL used to be.
	if strings.Contains(out, "questions .") {
		t.Errorf("stray space left behind:\n%s", out)
	}
}
