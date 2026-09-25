package store

import "testing"

func TestUnescapeDropsMarkdownEscapes(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"underscore", `store\_Open`, "store_Open"},
		{"asterisk", `2 \* 3`, "2 * 3"},
		{"several", `a\_b\*c\[d\]`, "a_b*c[d]"},
		{"escaped backslash", `C:\\Users`, `C:\Users`},
		// \U is not a markdown escape: U is not ASCII punctuation, so the
		// backslash is literal and has to survive. Windows paths depend on it.
		{"windows path", `C:\Users\prathmesh`, `C:\Users\prathmesh`},
		{"trailing backslash", `ends with \`, `ends with \`},
		{"nothing to do", "plain text", "plain text"},
		{"unicode untouched", `caf\é`, `caf\é`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Unescape(c.in); got != c.want {
				t.Errorf("Unescape(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}
