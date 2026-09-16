package attach

import (
	"mime"
	"net/http"
	"path/filepath"
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

// describe works out what a file is from its first bytes, falling back to the
// name the user gave it when the contents are not recognisable.
func describe(head []byte, name string) (mimeType, ext string) {
	mimeType = http.DetectContentType(head)
	// DetectContentType appends parameters, as in "text/plain; charset=utf-8".
	if base, _, err := mime.ParseMediaType(mimeType); err == nil {
		mimeType = base
	}
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
		return ".bin"
	}
	for _, r := range ext[1:] {
		if !('a' <= r && r <= 'z' || '0' <= r && r <= '9') {
			return ".bin"
		}
	}
	return ext
}
