package attach

import (
	"mime"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
)

// Ref is one stored file. It is what a caller turns into markdown, and what
// the web server answers a request with.
type Ref struct {
	ID   string // 16 hex characters of the SHA-256 of the contents
	Name string // the original filename, kept for the link text
	Ext  string // including the dot, derived from the contents
	MIME string
	Size int64
}

// Base is the name the file has on disk.
func (r Ref) Base() string { return r.ID + r.Ext }

// unknownExt is what a name contributes when it offers no usable extension.
const unknownExt = ".bin"

// extensions fixes the extension for the types worth naming properly. The
// standard library's mime.ExtensionsByType is not used here: it returns a
// slice in no guaranteed order, so the same bytes could be stored as .jpg on
// one machine and .jpe on another, and the deduplication would quietly stop
// working.
var extensions = map[string]string{
	"image/png":       ".png",
	"image/jpeg":      ".jpg",
	"image/gif":       ".gif",
	"image/webp":      ".webp",
	"image/bmp":       ".bmp",
	"image/svg+xml":   ".svg",
	"application/pdf": ".pdf",
	"application/zip": ".zip",
	"text/plain":      ".txt",
	"text/html":       ".html",
}

// containers are the types whose bytes do not say what the file really is.
// Every Office document, every .odt and every .epub is a zip; markdown, CSV,
// JSON and source code are all "plain text". Sniffing one of these tells you
// the envelope, not the contents — so for these the name the user gave is the
// better evidence, and the value here is only the fallback when the name
// offers nothing.
//
// This is why a .docx must not be stored as .zip: the extension is what the
// system opener uses to choose an application, and an archive manager is not
// what anyone wanted when they attached a Word document.
var containers = map[string]string{
	"application/zip":          ".zip",
	"application/octet-stream": ".bin",
	"text/plain":               ".txt",
}

// describe works out what a file is from its first bytes, falling back to the
// name the user gave it when the contents do not pin it down.
func describe(head []byte, name string) (mimeType, ext string) {
	mimeType = http.DetectContentType(head)
	// DetectContentType appends parameters, as in "text/plain; charset=utf-8".
	if base, _, err := mime.ParseMediaType(mimeType); err == nil {
		mimeType = base
	}
	if fallback, ok := containers[mimeType]; ok {
		if ext := extFromName(name); ext != unknownExt {
			return mimeType, ext
		}
		return mimeType, fallback
	}
	// A format whose bytes identify it: the contents win, and a PNG named
	// .jpg is still stored as a PNG.
	if ext, ok := extensions[mimeType]; ok {
		return mimeType, ext
	}
	return mimeType, extFromName(name)
}

// extFromName takes an extension off a filename, but only one that is safe to
// build a path out of: lowercase letters and digits, and short.
func extFromName(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	if len(ext) < 2 || len(ext) > 9 {
		return unknownExt
	}
	for _, r := range ext[1:] {
		if !('a' <= r && r <= 'z' || '0' <= r && r <= '9') {
			return unknownExt
		}
	}
	return ext
}

// markdownName escapes the characters that would otherwise end the link text
// early. Brackets are the only ones that can: parentheses inside link text are
// left alone, which keeps ordinary filenames readable.
var markdownName = strings.NewReplacer(`\`, `\\`, `[`, `\[`, `]`, `\]`)

// Markdown is the line to put in a note: the image form for an image, the
// plain link form for anything else.
func (r Ref) Markdown() string {
	name := r.Name
	if name == "" {
		name = "file"
		if r.isImage() {
			name = "image"
		}
	}
	link := "[" + markdownName.Replace(name) + "](attachments/" + r.Base() + ")"
	if r.isImage() {
		return "!" + link
	}
	return link
}

func (r Ref) isImage() bool { return strings.HasPrefix(r.MIME, "image/") }

// reference matches an attachment link as Markdown writes it. The leading
// boundary keeps a remote URL that happens to end the same way from counting:
// the reference must start right after "(" or whitespace, never after a "/".
var reference = regexp.MustCompile(`(^|[(\s])attachments/([0-9a-f]{16})\.[a-z0-9]{1,8}`)

// Refs reports the attachments a note's markdown refers to, in the order they
// appear and without repeats. It is pure: no files are opened.
//
// This is the only reader of the reference format, as Markdown is its only
// writer. Sweep trusts it completely - a reference it fails to see is a file
// that gets trashed while a note is still using it.
func Refs(markdown string) []string {
	matches := reference.FindAllStringSubmatch(markdown, -1)
	ids := make([]string, 0, len(matches))
	seen := make(map[string]struct{}, len(matches))
	for _, m := range matches {
		id := m[2]
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}
