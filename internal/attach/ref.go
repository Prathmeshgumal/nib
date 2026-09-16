package attach

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

// describe picks the content type and the extension. Task 4 replaces this.
func describe(head []byte, name string) (mimeType, ext string) {
	return "application/octet-stream", ".bin"
}
