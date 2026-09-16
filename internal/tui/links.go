package tui

import (
	"regexp"
	"strings"
)

var (
	// [text](https://example.com "optional title") and the image form.
	inlineLink = regexp.MustCompile(`(!?\[[^\]]*\])\(\s*([^()\s]+)(\s+"[^"]*")?\s*\)`)
	// A URL written on its own, which the renderer turns into a link anyway.
	bareURL = regexp.MustCompile(`https?://[^\s<>()\[\]"'\x00-\x1f]+`)
)

// eachLineOutsideCode applies fn to every line that is not inside a fenced
// code block, leaving code samples untouched.
func eachLineOutsideCode(md string, fn func(line string) string) string {
	lines := strings.Split(md, "\n")
	inFence := false
	for i, line := range lines {
		if codeFence.MatchString(line) {
			inFence = !inFence
			continue
		}
		if !inFence {
			lines[i] = fn(line)
		}
	}
	return strings.Join(lines, "\n")
}
