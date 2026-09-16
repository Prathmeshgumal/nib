# Attachment Store (PR A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `internal/attach`, the package that stores a note's attached files on disk, content-addressed, with a trash that matches how notes already behave.

**Architecture:** A directory beside the database holds every attached file under a name derived from the SHA-256 of its contents. The package owns that directory and the markdown reference format, and nothing else — it never imports `store`, never opens a database, and never touches the network. Reconciliation replaces bookkeeping: callers hand it the set of ids the notes actually reference and it moves files between live and trash to match.

**Tech Stack:** Go 1.25, standard library only. No new module dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-attachments-design.md`

## Global Constraints

- **No new dependencies.** `go.mod` must be unchanged by this PR. Standard library only.
- **Commit messages:** a single line, at most 10 words, plain everyday words. No `feat:`/`fix:` prefixes, no body, no attribution footer or emoji. "add the attachment store" — not "feat: implement content-addressed attachment storage layer".
- **Go is not on the default PATH.** Every command needs `export PATH="$HOME/.local/go/bin:$PATH"` first.
- **Branch:** work on `attachments-store`, branched from `main`. Never commit to `main`. Open a PR at the end; do not merge it.
- **Size cap:** `MaxSize = 50 << 20` (50 MB).
- **ID format:** the first 16 hex characters of the SHA-256 of the file contents.
- **Reference format:** `attachments/<id><ext>`, relative, as it appears in note markdown.
- **Tests are hermetic:** `t.TempDir()` only. No network, no fixed paths, no sleeps.
- **Comments explain why, not what.** Match the surrounding codebase, which uses full sentences and explains reasoning (see `internal/tui/layout.go` for the house style).

## File Structure

- `internal/attach/attach.go` — `Store`, `Open`, `Add`, `Open` (read), errors. The directory's owner.
- `internal/attach/ref.go` — `Ref`, the extension table, `Ref.Markdown`, `Refs`. The reference format's owner: the only file that knows how an attachment is spelled in a note.
- `internal/attach/sweep.go` — `Sweep`, `PurgeExpired`. Reconciliation.
- `internal/attach/attach_test.go`, `ref_test.go`, `sweep_test.go` — mirroring the above.

Split this way because the reference format is consumed by three future PRs and must have exactly one definition; keeping it in its own file makes that boundary obvious.

---

### Task 1: The directory and its guards

**Files:**
- Create: `internal/attach/attach.go`
- Create: `internal/attach/attach_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `func Open(dir string) (*Store, error)`; `type Store struct{ dir string }`; `func (s *Store) Dir() string`; `var ErrTooLarge, ErrBadName, ErrNotFound error`; `const MaxSize = 50 << 20`.

- [ ] **Step 1: Write the failing test**

```go
package attach

import (
	"os"
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "attachments"))
	if err != nil {
		t.Fatalf("opening store: %v", err)
	}
	return s
}

func TestOpenCreatesTheLayout(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "attachments")
	if _, err := Open(dir); err != nil {
		t.Fatalf("opening store: %v", err)
	}
	for _, sub := range []string{".", ".trash", ".tmp"} {
		info, err := os.Stat(filepath.Join(dir, sub))
		if err != nil {
			t.Fatalf("%s missing after Open: %v", sub, err)
		}
		if !info.IsDir() {
			t.Errorf("%s is not a directory", sub)
		}
	}
}

func TestOpenIsIdempotent(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "attachments")
	if _, err := Open(dir); err != nil {
		t.Fatalf("first open: %v", err)
	}
	if _, err := Open(dir); err != nil {
		t.Fatalf("second open on an existing directory: %v", err)
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -run TestOpen -v`
Expected: FAIL — `undefined: Open`.

- [ ] **Step 3: Write the implementation**

```go
// Package attach stores the files a note refers to. It owns one directory on
// disk and nothing else: it never opens a database and never reaches the
// network, so a caller can point it at a temporary directory and test it whole.
package attach

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// MaxSize is the largest file we will take. Well past any screenshot, phone
// photo or ordinary PDF, and far short of the point where a mis-dropped video
// copies for a minute before anyone notices.
const MaxSize = 50 << 20

var (
	// ErrTooLarge means the file is bigger than MaxSize. Nothing was written.
	ErrTooLarge = errors.New("attachment is too large")
	// ErrBadName means the name is not one this package could have written.
	ErrBadName = errors.New("not an attachment name")
	// ErrNotFound means there is no such attachment.
	ErrNotFound = errors.New("attachment not found")
)

const (
	trashDir = ".trash"
	tmpDir   = ".tmp"
)

// Store is one attachments directory.
type Store struct {
	dir string
}

// Open prepares the directory, creating it and its two sub-directories if they
// are not there. Opening an existing directory is not an error: this runs on
// every launch.
func Open(dir string) (*Store, error) {
	for _, d := range []string{dir, filepath.Join(dir, trashDir), filepath.Join(dir, tmpDir)} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, fmt.Errorf("creating %s: %w", d, err)
		}
	}
	return &Store{dir: dir}, nil
}

// Dir is the directory the store owns.
func (s *Store) Dir() string { return s.dir }
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -v`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add internal/attach/attach.go internal/attach/attach_test.go
git commit -m "add the attachments directory"
```

---

### Task 2: Storing a file, and storing it only once

**Files:**
- Modify: `internal/attach/attach.go`
- Create: `internal/attach/ref.go`
- Modify: `internal/attach/attach_test.go`

**Interfaces:**
- Consumes: `Store`, `MaxSize` from Task 1.
- Produces: `type Ref struct { ID, Name, Ext, MIME string; Size int64 }`; `func (s *Store) Add(name string, r io.Reader) (Ref, error)`.

Writes go to `.tmp` first and are renamed into place, so a process killed
mid-write leaves no half-file for the next launch to serve. A destination that
already exists means these exact bytes are already stored — that is the whole
of deduplication, and it falls out of naming files after their contents.

- [ ] **Step 1: Write the failing test**

```go
func TestAddStoresTheBytes(t *testing.T) {
	s := newTestStore(t)

	ref, err := s.Add("hello.txt", strings.NewReader("hello"))
	if err != nil {
		t.Fatalf("adding: %v", err)
	}
	if ref.Size != 5 {
		t.Errorf("Size = %d, want 5", ref.Size)
	}
	if ref.Name != "hello.txt" {
		t.Errorf("Name = %q, want the name we passed in", ref.Name)
	}
	if len(ref.ID) != 16 {
		t.Errorf("ID = %q, want 16 hex characters", ref.ID)
	}

	got, err := os.ReadFile(filepath.Join(s.Dir(), ref.ID+ref.Ext))
	if err != nil {
		t.Fatalf("reading it back: %v", err)
	}
	if string(got) != "hello" {
		t.Errorf("stored %q, want %q", got, "hello")
	}
}

func TestAddIsContentAddressed(t *testing.T) {
	s := newTestStore(t)

	// The same bytes under two different names are one file with one id.
	a, err := s.Add("first.txt", strings.NewReader("same bytes"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Add("second.txt", strings.NewReader("same bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if a.ID != b.ID {
		t.Errorf("ids %q and %q differ for identical contents", a.ID, b.ID)
	}

	entries, err := os.ReadDir(s.Dir())
	if err != nil {
		t.Fatal(err)
	}
	var files int
	for _, e := range entries {
		if !e.IsDir() {
			files++
		}
	}
	if files != 1 {
		t.Errorf("stored %d files, want the duplicate to have been recognised", files)
	}
}

func TestAddLeavesNoTemporaryFiles(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Add("a.txt", strings.NewReader("x")); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(s.Dir(), ".tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("%d files left in .tmp, want none", len(entries))
	}
}
```

Add `"io"`, `"strings"` to the test imports.

- [ ] **Step 2: Run the test and watch it fail**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -run TestAdd -v`
Expected: FAIL — `s.Add undefined`.

- [ ] **Step 3: Write the implementation**

Create `internal/attach/ref.go`:

```go
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
```

Add to `internal/attach/attach.go`:

```go
// Add copies the bytes in and returns a reference to them. Adding the same
// bytes twice returns the same id and writes nothing the second time.
func (s *Store) Add(name string, r io.Reader) (Ref, error) {
	tmp, err := os.CreateTemp(filepath.Join(s.dir, tmpDir), "incoming-*")
	if err != nil {
		return Ref{}, fmt.Errorf("opening a temporary file: %w", err)
	}
	// Removing a file that was renamed away fails harmlessly, so this covers
	// every path out of the function without a flag to track success.
	defer func() {
		tmp.Close()
		os.Remove(tmp.Name())
	}()

	sum := sha256.New()
	// The first bytes decide the content type, so keep them as they go past.
	head := &headBuffer{limit: 512}
	dst := io.MultiWriter(tmp, sum, head)

	size, err := io.Copy(dst, r)
	if err != nil {
		return Ref{}, fmt.Errorf("reading the file: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		return Ref{}, fmt.Errorf("flushing the file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return Ref{}, fmt.Errorf("closing the file: %w", err)
	}

	mimeType, ext := describe(head.buf, name)
	ref := Ref{
		ID:   hex.EncodeToString(sum.Sum(nil))[:16],
		Name: name,
		Ext:  ext,
		MIME: mimeType,
		Size: size,
	}

	final := filepath.Join(s.dir, ref.Base())
	if _, err := os.Stat(final); err == nil {
		return ref, nil // these exact bytes are already here
	}
	if err := os.Rename(tmp.Name(), final); err != nil {
		return Ref{}, fmt.Errorf("storing the file: %w", err)
	}
	return ref, nil
}

// headBuffer keeps the first limit bytes written to it and discards the rest,
// so the content sniffer can see the start of a file of any size without
// holding the whole thing in memory. It is a pointer receiver because the
// buffer has to survive between writes.
type headBuffer struct {
	buf   []byte
	limit int
}

func (h *headBuffer) Write(p []byte) (int, error) {
	if room := h.limit - len(h.buf); room > 0 {
		h.buf = append(h.buf, p[:min(len(p), room)]...)
	}
	return len(p), nil
}
```

Imports to add to `attach.go`: `crypto/sha256`, `encoding/hex`, `io`.

`describe` is written in Task 4. Until then, stub it at the bottom of `ref.go`
so this task compiles and its tests pass:

```go
// describe picks the content type and the extension. Task 4 replaces this.
func describe(head []byte, name string) (mime, ext string) {
	return "application/octet-stream", ".bin"
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -v`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add internal/attach/
git commit -m "store attached files by their contents"
```

---

### Task 3: Refusing a file that is too large

**Files:**
- Modify: `internal/attach/attach.go`
- Modify: `internal/attach/attach_test.go`

**Interfaces:**
- Consumes: `Add`, `MaxSize`, `ErrTooLarge`.
- Produces: no new names. `Add` now returns `ErrTooLarge` past the cap.

The cap lives here rather than in the HTTP handler or the TUI so that both
front ends inherit one limit from one place.

- [ ] **Step 1: Write the failing test**

```go
func TestAddRefusesAFileOverTheCap(t *testing.T) {
	s := newTestStore(t)

	// One byte past the cap, streamed rather than allocated.
	_, err := s.Add("huge.bin", io.LimitReader(zeros{}, MaxSize+1))
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("err = %v, want ErrTooLarge", err)
	}

	for _, sub := range []string{".", ".tmp"} {
		entries, err := os.ReadDir(filepath.Join(s.Dir(), sub))
		if err != nil {
			t.Fatal(err)
		}
		var files int
		for _, e := range entries {
			if !e.IsDir() {
				files++
			}
		}
		if files != 0 {
			t.Errorf("%s holds %d files after a refused add, want none", sub, files)
		}
	}
}

func TestAddAcceptsAFileExactlyAtTheCap(t *testing.T) {
	s := newTestStore(t)
	ref, err := s.Add("big.bin", io.LimitReader(zeros{}, MaxSize))
	if err != nil {
		t.Fatalf("a file exactly at the cap was refused: %v", err)
	}
	if ref.Size != MaxSize {
		t.Errorf("Size = %d, want %d", ref.Size, MaxSize)
	}
}

// zeros is an endless reader, so a large test file costs no memory.
type zeros struct{}

func (zeros) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}
```

Add `"errors"` to the test imports.

- [ ] **Step 2: Run the test and watch it fail**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -run TestAddRefuses -v`
Expected: FAIL — the oversized file is stored and `err` is nil.

- [ ] **Step 3: Write the implementation**

In `Add`, replace the `io.Copy` line with a copy that reads one byte past the
cap, so hitting the limit is distinguishable from ending exactly on it:

```go
	size, err := io.Copy(dst, io.LimitReader(r, MaxSize+1))
	if err != nil {
		return Ref{}, fmt.Errorf("reading the file: %w", err)
	}
	if size > MaxSize {
		return Ref{}, fmt.Errorf("%s is %d bytes: %w", name, size, ErrTooLarge)
	}
```

The deferred cleanup from Task 2 already removes the temporary file on this
path, which is what the test's second half checks.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -v`
Expected: PASS. The two cap tests write 50 MB to a temp directory and take a
second or so.

- [ ] **Step 5: Commit**

```bash
git add internal/attach/
git commit -m "refuse attachments over fifty megabytes"
```

---

### Task 4: Naming the file after what it actually is

**Files:**
- Modify: `internal/attach/ref.go`
- Create: `internal/attach/ref_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `func describe(head []byte, name string) (mime, ext string)`.

The extension comes from the contents, not the supplied filename, so the same
bytes always produce the same path — which is what makes deduplication work.
`mime.ExtensionsByType` is deliberately not used: it returns a slice whose
order is not guaranteed, so `image/jpeg` could come back `.jpe` on one machine
and `.jpg` on another, and identical bytes would be stored twice.

- [ ] **Step 1: Write the failing test**

```go
package attach

import "testing"

func TestDescribeNamesFilesAfterTheirContents(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n" + "the rest does not matter")
	gif := []byte("GIF89a and some more")
	pdf := []byte("%PDF-1.7\nnot really a pdf")

	for _, c := range []struct {
		what     string
		head     []byte
		name     string
		wantMIME string
		wantExt  string
	}{
		{"a png", png, "shot.png", "image/png", ".png"},
		{"a png misnamed as a jpg", png, "shot.jpg", "image/png", ".png"},
		{"a gif", gif, "loop.gif", "image/gif", ".gif"},
		{"a pdf", pdf, "report.pdf", "application/pdf", ".pdf"},
		{"plain text", []byte("just words"), "notes.txt", "text/plain", ".txt"},
	} {
		mime, ext := describe(c.head, c.name)
		if mime != c.wantMIME || ext != c.wantExt {
			t.Errorf("%s: describe = %q, %q; want %q, %q", c.what, mime, ext, c.wantMIME, c.wantExt)
		}
	}
}

func TestDescribeFallsBackToTheGivenName(t *testing.T) {
	// Bytes the sniffer cannot place, with a plausible extension on the name.
	odd := []byte{0x00, 0x01, 0x02, 0x03, 0xff, 0xfe}

	if _, ext := describe(odd, "archive.tar.zst"); ext != ".zst" {
		t.Errorf("ext = %q, want .zst taken from the name", ext)
	}
	if _, ext := describe(odd, "LICENSE"); ext != ".bin" {
		t.Errorf("ext = %q, want .bin when the name offers nothing", ext)
	}
	if _, ext := describe(odd, "weird.LOUD"); ext != ".loud" {
		t.Errorf("ext = %q, want the extension lowercased", ext)
	}
	// A name that would escape the directory contributes nothing.
	if _, ext := describe(odd, "../../etc/passwd"); ext != ".bin" {
		t.Errorf("ext = %q, want .bin for a name with no usable extension", ext)
	}
}

func TestDescribeIsDeterministic(t *testing.T) {
	jpg := []byte("\xff\xd8\xff\xe0 jpeg-ish")
	first, firstExt := describe(jpg, "a.jpg")
	for i := 0; i < 100; i++ {
		mime, ext := describe(jpg, "a.jpg")
		if mime != first || ext != firstExt {
			t.Fatalf("describe is not deterministic: got %q,%q then %q,%q", first, firstExt, mime, ext)
		}
	}
	if firstExt != ".jpg" {
		t.Errorf("ext = %q, want .jpg", firstExt)
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -run TestDescribe -v`
Expected: FAIL — the stub returns `application/octet-stream`, `.bin` for everything.

- [ ] **Step 3: Write the implementation**

Replace the stub in `ref.go`:

```go
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
```

Imports for `ref.go`: `mime`, `net/http`, `path/filepath`, `strings`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -v`
Expected: PASS. `TestAddStoresTheBytes` now sees `.txt` rather than `.bin`;
it does not assert on the extension, so it keeps passing.

- [ ] **Step 5: Commit**

```bash
git add internal/attach/
git commit -m "name stored files after their real type"
```

---

### Task 5: Writing the reference into a note

**Files:**
- Modify: `internal/attach/ref.go`
- Modify: `internal/attach/ref_test.go`

**Interfaces:**
- Consumes: `Ref` from Task 2.
- Produces: `func (r Ref) Markdown() string`.

- [ ] **Step 1: Write the failing test**

```go
func TestRefMarkdown(t *testing.T) {
	image := Ref{ID: "8f3a91c2d4e5f607", Name: "screenshot.png", Ext: ".png", MIME: "image/png"}
	if got, want := image.Markdown(), "![screenshot.png](attachments/8f3a91c2d4e5f607.png)"; got != want {
		t.Errorf("image: got %q, want %q", got, want)
	}

	doc := Ref{ID: "2b7c0419aa3d1e88", Name: "report.pdf", Ext: ".pdf", MIME: "application/pdf"}
	if got, want := doc.Markdown(), "[report.pdf](attachments/2b7c0419aa3d1e88.pdf)"; got != want {
		t.Errorf("document: got %q, want %q", got, want)
	}
}

func TestRefMarkdownEscapesTheName(t *testing.T) {
	// A filename with brackets would otherwise end the link text early and
	// leave the rest of the name loose in the note.
	r := Ref{ID: "0123456789abcdef", Name: "photo [final] (2).png", Ext: ".png", MIME: "image/png"}
	got := r.Markdown()
	want := `![photo \[final\] (2).png](attachments/0123456789abcdef.png)`
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestRefMarkdownSurvivesAnEmptyName(t *testing.T) {
	r := Ref{ID: "0123456789abcdef", Name: "", Ext: ".png", MIME: "image/png"}
	if got, want := r.Markdown(), "![image](attachments/0123456789abcdef.png)"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -run TestRefMarkdown -v`
Expected: FAIL — `r.Markdown undefined`.

- [ ] **Step 3: Write the implementation**

```go
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
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/attach/
git commit -m "write the markdown line for an attachment"
```

---

### Task 6: Reading references back out of a note

**Files:**
- Modify: `internal/attach/ref.go`
- Modify: `internal/attach/ref_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `func Refs(markdown string) []string` — the ids, without extensions, in order, deduplicated.

This is the counterpart to `Markdown`, and the pair is why both live in one
file: if they ever disagree about the format, `Sweep` stops seeing live
references and trashes files that are still in use.

- [ ] **Step 1: Write the failing test**

```go
func TestRefsFindsEveryForm(t *testing.T) {
	md := `# Notes

![shot](attachments/8f3a91c2d4e5f607.png) and a file
[report.pdf](attachments/2b7c0419aa3d1e88.pdf).

The same image again: ![again](attachments/8f3a91c2d4e5f607.png)
`
	got := Refs(md)
	want := []string{"8f3a91c2d4e5f607", "2b7c0419aa3d1e88"}
	if !slices.Equal(got, want) {
		t.Errorf("Refs = %v, want %v (in order, without repeats)", got, want)
	}
}

func TestRefsIgnoresWhatIsNotOurs(t *testing.T) {
	md := `
![remote](https://example.com/attachments/8f3a91c2d4e5f607.png)
![short](attachments/8f3a91.png)
![capitals](attachments/8F3A91C2D4E5F607.png)
[a folder](attachments/)
plain text mentioning attachments/ and nothing else
`
	if got := Refs(md); len(got) != 0 {
		t.Errorf("Refs = %v, want none of these to count", got)
	}
}

func TestRefsOfAnEmptyNote(t *testing.T) {
	if got := Refs(""); len(got) != 0 {
		t.Errorf("Refs = %v, want empty", got)
	}
}
```

Add `"slices"` to the test imports.

A remote URL ending in the same path must not count: it is somebody else's
file, and treating it as a live reference would pin a local file forever.

- [ ] **Step 2: Run the test and watch it fail**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -run TestRefs -v`
Expected: FAIL — `undefined: Refs`.

- [ ] **Step 3: Write the implementation**

```go
// reference matches an attachment link as Markdown writes it. The leading
// boundary keeps a remote URL that happens to end the same way from counting:
// the reference must start right after "(" or whitespace, never after a "/".
var reference = regexp.MustCompile(`(^|[(\s])attachments/([0-9a-f]{16})\.[a-z0-9]{1,8}`)

// Refs reports the attachments a note's markdown refers to, in the order they
// appear and without repeats. It is pure: no files are opened.
//
// This is the only reader of the reference format, as Markdown is its only
// writer. Sweep trusts it completely — a reference it fails to see is a file
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
```

Add `regexp` to the imports in `ref.go`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -v`
Expected: PASS.

- [ ] **Step 5: Add the test that ties the pair together, and run it**

```go
func TestMarkdownAndRefsAgree(t *testing.T) {
	// Whatever Markdown writes, Refs must find. These two are the only writer
	// and the only reader of the format; if they drift apart, Sweep trashes
	// files that notes are still using.
	for _, r := range []Ref{
		{ID: "8f3a91c2d4e5f607", Name: "shot.png", Ext: ".png", MIME: "image/png"},
		{ID: "2b7c0419aa3d1e88", Name: "report.pdf", Ext: ".pdf", MIME: "application/pdf"},
		{ID: "0123456789abcdef", Name: "photo [final].png", Ext: ".png", MIME: "image/png"},
		{ID: "fedcba9876543210", Name: "", Ext: ".bin", MIME: "application/octet-stream"},
	} {
		got := Refs(r.Markdown())
		if len(got) != 1 || got[0] != r.ID {
			t.Errorf("Refs(%q) = %v, want [%s]", r.Markdown(), got, r.ID)
		}
	}
}
```

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -run TestMarkdownAndRefsAgree -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/attach/
git commit -m "read attachment references back out of a note"
```

---

### Task 7: Serving a file without being talked out of the directory

**Files:**
- Modify: `internal/attach/attach.go`
- Modify: `internal/attach/attach_test.go`

**Interfaces:**
- Consumes: `Store`, `ErrBadName`, `ErrNotFound`.
- Produces: `func (s *Store) Read(base string) (*os.File, error)`; `func validBase(base string) bool`.

Named `Read` rather than `Open` so it does not collide with the package-level
`Open`. The name is checked against the exact shape this package writes before
it is used to build a path, so a caller cannot reach a file outside the
directory no matter what the request said.

- [ ] **Step 1: Write the failing test**

```go
func TestReadReturnsTheFile(t *testing.T) {
	s := newTestStore(t)
	ref, err := s.Add("hello.txt", strings.NewReader("hello"))
	if err != nil {
		t.Fatal(err)
	}

	f, err := s.Read(ref.Base())
	if err != nil {
		t.Fatalf("reading %s: %v", ref.Base(), err)
	}
	defer f.Close()

	got, err := io.ReadAll(f)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "hello" {
		t.Errorf("read %q, want %q", got, "hello")
	}
}

func TestReadRefusesAnythingItDidNotWrite(t *testing.T) {
	s := newTestStore(t)

	// A real file one level up, to prove the traversal cases are not just
	// failing because the target happens not to exist.
	outside := filepath.Join(filepath.Dir(s.Dir()), "secret.txt")
	if err := os.WriteFile(outside, []byte("private"), 0o600); err != nil {
		t.Fatal(err)
	}

	for _, base := range []string{
		"../secret.txt",
		"../../etc/passwd",
		"/etc/passwd",
		".trash/8f3a91c2d4e5f607.png",
		"8f3a91c2d4e5f607.png/../../secret.txt",
		"8F3A91C2D4E5F607.png",
		"8f3a91.png",
		"8f3a91c2d4e5f607",
		"8f3a91c2d4e5f607.png.exe",
		"",
		".",
		"..",
	} {
		f, err := s.Read(base)
		if err == nil {
			f.Close()
			t.Errorf("Read(%q) succeeded, want it refused", base)
			continue
		}
		if !errors.Is(err, ErrBadName) {
			t.Errorf("Read(%q) = %v, want ErrBadName", base, err)
		}
	}
}

func TestReadOfAMissingFile(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Read("8f3a91c2d4e5f607.png"); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -run TestRead -v`
Expected: FAIL — `s.Read undefined`.

- [ ] **Step 3: Write the implementation**

```go
// name is the exact shape this package writes: sixteen lowercase hex
// characters, a dot, and a short lowercase extension. Anything else is
// refused before it is used to build a path, so no request can name a file
// outside the directory however it is spelled or encoded.
var name = regexp.MustCompile(`^[0-9a-f]{16}\.[a-z0-9]{1,8}$`)

func validBase(base string) bool { return name.MatchString(base) }

// Read opens a stored attachment by its name on disk.
func (s *Store) Read(base string) (*os.File, error) {
	if !validBase(base) {
		return nil, fmt.Errorf("%q: %w", base, ErrBadName)
	}
	f, err := os.Open(filepath.Join(s.dir, base))
	if errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("%s: %w", base, ErrNotFound)
	}
	if err != nil {
		return nil, err
	}
	return f, nil
}
```

Add `regexp` to the imports in `attach.go`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/attach/
git commit -m "read an attachment back by name"
```

---

### Task 8: Reconciling the directory against the notes

**Files:**
- Create: `internal/attach/sweep.go`
- Create: `internal/attach/sweep_test.go`

**Interfaces:**
- Consumes: `Store`, `trashDir`, `validBase` from earlier tasks.
- Produces: `func (s *Store) Sweep(referenced map[string]struct{}) (trashed, restored int, err error)`.

Sweep moves files both ways. Live but unreferenced goes to the trash; trashed
but referenced again comes back. The second direction is what makes undo and
restoring a note from the trash work without a line of special-case code.

The mtime is stamped when a file is trashed, because rename keeps the original
and `PurgeExpired` in Task 9 reads it: without the stamp, a file written a year
ago would be purged the moment it was trashed.

- [ ] **Step 1: Write the failing test**

```go
package attach

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// add stores a file and returns its name on disk.
func add(t *testing.T, s *Store, body string) string {
	t.Helper()
	ref, err := s.Add("f.txt", strings.NewReader(body))
	if err != nil {
		t.Fatalf("adding %q: %v", body, err)
	}
	return ref.Base()
}

func live(t *testing.T, s *Store, base string) bool {
	t.Helper()
	_, err := os.Stat(filepath.Join(s.Dir(), base))
	return err == nil
}

func trashed(t *testing.T, s *Store, base string) bool {
	t.Helper()
	_, err := os.Stat(filepath.Join(s.Dir(), ".trash", base))
	return err == nil
}

func refs(bases ...string) map[string]struct{} {
	m := make(map[string]struct{}, len(bases))
	for _, b := range bases {
		m[strings.TrimSuffix(b, filepath.Ext(b))] = struct{}{}
	}
	return m
}

func TestSweepTrashesWhatNoNoteUses(t *testing.T) {
	s := newTestStore(t)
	kept := add(t, s, "still referenced")
	dropped := add(t, s, "nothing points here")

	gone, back, err := s.Sweep(refs(kept))
	if err != nil {
		t.Fatal(err)
	}
	if gone != 1 || back != 0 {
		t.Errorf("Sweep = %d trashed, %d restored; want 1, 0", gone, back)
	}
	if !live(t, s, kept) {
		t.Errorf("%s was trashed although a note references it", kept)
	}
	if live(t, s, dropped) || !trashed(t, s, dropped) {
		t.Errorf("%s should have moved to the trash", dropped)
	}
}

func TestSweepBringsBackAFileThatIsUsedAgain(t *testing.T) {
	s := newTestStore(t)
	base := add(t, s, "undo me")

	if _, _, err := s.Sweep(refs()); err != nil {
		t.Fatal(err)
	}
	if !trashed(t, s, base) {
		t.Fatalf("%s did not reach the trash", base)
	}

	// The note is edited back, or restored from the note trash.
	gone, back, err := s.Sweep(refs(base))
	if err != nil {
		t.Fatal(err)
	}
	if gone != 0 || back != 1 {
		t.Errorf("Sweep = %d trashed, %d restored; want 0, 1", gone, back)
	}
	if !live(t, s, base) || trashed(t, s, base) {
		t.Errorf("%s was not brought back", base)
	}
}

func TestSweepIsIdempotent(t *testing.T) {
	s := newTestStore(t)
	base := add(t, s, "orphan")

	if _, _, err := s.Sweep(refs()); err != nil {
		t.Fatal(err)
	}
	gone, back, err := s.Sweep(refs())
	if err != nil {
		t.Fatal(err)
	}
	if gone != 0 || back != 0 {
		t.Errorf("second Sweep = %d, %d; want it to have nothing left to do", gone, back)
	}
	if !trashed(t, s, base) {
		t.Errorf("%s left the trash on a second sweep", base)
	}
}

func TestSweepIgnoresStrangers(t *testing.T) {
	s := newTestStore(t)
	// A file a person dropped in by hand, and our own working directories.
	stray := filepath.Join(s.Dir(), "notes-of-my-own.txt")
	if err := os.WriteFile(stray, []byte("mine"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, _, err := s.Sweep(refs()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stray); err != nil {
		t.Errorf("a file we did not write was moved: %v", err)
	}
	for _, sub := range []string{".trash", ".tmp"} {
		if _, err := os.Stat(filepath.Join(s.Dir(), sub)); err != nil {
			t.Errorf("%s was disturbed: %v", sub, err)
		}
	}
}

func TestSweepStampsTheTrashTime(t *testing.T) {
	s := newTestStore(t)
	base := add(t, s, "orphan")

	// Backdate the live file. Rename preserves the modification time, so
	// without an explicit stamp the file would look old the instant it is
	// trashed and PurgeExpired would delete it immediately.
	old := time.Now().Add(-365 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(s.Dir(), base), old, old); err != nil {
		t.Fatal(err)
	}

	before := time.Now()
	if _, _, err := s.Sweep(refs()); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(s.Dir(), ".trash", base))
	if err != nil {
		t.Fatal(err)
	}
	if info.ModTime().Before(before.Add(-time.Minute)) {
		t.Errorf("trashed at %v, want it stamped with roughly now (%v)", info.ModTime(), before)
	}
}
```

`TestSweepIgnoresStrangers` is what covers leaving `.trash` and `.tmp` alone.
Add `"time"` to the imports.

- [ ] **Step 2: Run the test and watch it fail**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -run TestSweep -v`
Expected: FAIL — `s.Sweep undefined`.

- [ ] **Step 3: Write the implementation**

```go
package attach

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Sweep reconciles the directory against the ids the notes actually use.
//
// Files no note refers to move to the trash, and files in the trash that a
// note refers to again come back. That second direction is why this is a
// reconciliation rather than a delete: undoing an edit, or restoring a note
// from the note trash, needs no special handling at all.
//
// Files this package did not write are never touched, so a directory someone
// keeps their own things in stays intact.
func (s *Store) Sweep(referenced map[string]struct{}) (trashed, restored int, err error) {
	move := func(from, to, base string) error {
		src := filepath.Join(from, base)
		dst := filepath.Join(to, base)
		if err := os.Rename(src, dst); err != nil {
			return fmt.Errorf("moving %s: %w", base, err)
		}
		// Rename keeps the original modification time, and PurgeExpired reads
		// it to decide what is old. Stamp it so the clock starts now.
		now := time.Now()
		if err := os.Chtimes(dst, now, now); err != nil {
			return fmt.Errorf("stamping %s: %w", base, err)
		}
		return nil
	}

	trash := filepath.Join(s.dir, trashDir)

	live, err := os.ReadDir(s.dir)
	if err != nil {
		return 0, 0, fmt.Errorf("reading the attachments directory: %w", err)
	}
	for _, e := range live {
		if e.IsDir() || !validBase(e.Name()) {
			continue
		}
		if _, ok := referenced[idOf(e.Name())]; ok {
			continue
		}
		if err := move(s.dir, trash, e.Name()); err != nil {
			return trashed, restored, err
		}
		trashed++
	}

	gone, err := os.ReadDir(trash)
	if err != nil {
		return trashed, restored, fmt.Errorf("reading the attachment trash: %w", err)
	}
	for _, e := range gone {
		if e.IsDir() || !validBase(e.Name()) {
			continue
		}
		if _, ok := referenced[idOf(e.Name())]; !ok {
			continue
		}
		if err := move(trash, s.dir, e.Name()); err != nil {
			return trashed, restored, err
		}
		restored++
	}
	return trashed, restored, nil
}

// idOf is the id part of a name on disk. Only ever called on names validBase
// has already accepted.
func idOf(base string) string { return strings.TrimSuffix(base, filepath.Ext(base)) }
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/attach/
git commit -m "move unused attachments to the trash"
```

---

### Task 9: Emptying the trash on the same clock as notes

**Files:**
- Modify: `internal/attach/sweep.go`
- Modify: `internal/attach/sweep_test.go`

**Interfaces:**
- Consumes: `Store`, `trashDir`, `validBase`.
- Produces: `func (s *Store) PurgeExpired(d time.Duration) (int, error)`.

The retention is a parameter rather than a constant here so the caller can pass
`store.TrashRetention` and the two trashes cannot drift apart, and so the tests
need no sleeps.

- [ ] **Step 1: Write the failing test**

```go
func TestPurgeExpiredDeletesOnlyWhatIsOldEnough(t *testing.T) {
	s := newTestStore(t)
	recent := add(t, s, "trashed a moment ago")
	ancient := add(t, s, "trashed long ago")

	if _, _, err := s.Sweep(refs()); err != nil {
		t.Fatal(err)
	}

	// Backdate one of them past the retention window.
	old := time.Now().Add(-40 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(s.Dir(), ".trash", ancient), old, old); err != nil {
		t.Fatal(err)
	}

	n, err := s.PurgeExpired(30 * 24 * time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("purged %d, want 1", n)
	}
	if !trashed(t, s, recent) {
		t.Errorf("%s was purged although it is recent", recent)
	}
	if trashed(t, s, ancient) {
		t.Errorf("%s survived although it is past the window", ancient)
	}
}

func TestPurgeExpiredLeavesLiveFilesAlone(t *testing.T) {
	s := newTestStore(t)
	base := add(t, s, "in use")

	old := time.Now().Add(-365 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(s.Dir(), base), old, old); err != nil {
		t.Fatal(err)
	}

	n, err := s.PurgeExpired(30 * 24 * time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("purged %d, want 0: PurgeExpired must only ever read the trash", n)
	}
	if !live(t, s, base) {
		t.Errorf("%s was deleted from the live directory", base)
	}
}

func TestPurgeExpiredOnAnEmptyTrash(t *testing.T) {
	s := newTestStore(t)
	n, err := s.PurgeExpired(30 * 24 * time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("purged %d from an empty trash, want 0", n)
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -run TestPurge -v`
Expected: FAIL — `s.PurgeExpired undefined`.

- [ ] **Step 3: Write the implementation**

```go
// PurgeExpired deletes trashed attachments older than d. The caller passes the
// same retention notes use, so the two trashes empty on one clock.
//
// It reads nothing but the trash directory: a live file is never deleted here
// however old it is.
func (s *Store) PurgeExpired(d time.Duration) (int, error) {
	trash := filepath.Join(s.dir, trashDir)
	entries, err := os.ReadDir(trash)
	if err != nil {
		return 0, fmt.Errorf("reading the attachment trash: %w", err)
	}

	cutoff := time.Now().Add(-d)
	var purged int
	for _, e := range entries {
		if e.IsDir() || !validBase(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue // it went away underneath us; nothing to do
		}
		if info.ModTime().After(cutoff) {
			continue
		}
		if err := os.Remove(filepath.Join(trash, e.Name())); err != nil {
			return purged, fmt.Errorf("deleting %s: %w", e.Name(), err)
		}
		purged++
	}
	return purged, nil
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -v`
Expected: PASS, every test in the package.

- [ ] **Step 5: Commit**

```bash
git add internal/attach/
git commit -m "empty the attachment trash after thirty days"
```

---

### Task 10: Prove the package holds together, and open the PR

**Files:**
- Modify: `internal/attach/attach_test.go`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new.

One test that walks the whole life of a file, because the per-task tests each
check one hinge and none of them checks that the hinges line up.

- [ ] **Step 1: Write the test**

```go
func TestTheLifeOfAnAttachment(t *testing.T) {
	s := newTestStore(t)

	// Someone drops a picture into a note.
	ref, err := s.Add("holiday.png", strings.NewReader("\x89PNG\r\n\x1a\npretend this is a picture"))
	if err != nil {
		t.Fatal(err)
	}
	if ref.MIME != "image/png" || ref.Ext != ".png" {
		t.Fatalf("stored as %s%s, want an image/png .png", ref.MIME, ref.Ext)
	}

	note := "# Holiday\n\n" + ref.Markdown() + "\n"
	ids := Refs(note)
	if len(ids) != 1 || ids[0] != ref.ID {
		t.Fatalf("Refs(note) = %v, want [%s]", ids, ref.ID)
	}

	// While the note refers to it, sweeping changes nothing.
	referenced := map[string]struct{}{ref.ID: {}}
	if gone, back, err := s.Sweep(referenced); err != nil || gone != 0 || back != 0 {
		t.Fatalf("Sweep while referenced = %d, %d, %v; want 0, 0, nil", gone, back, err)
	}
	if _, err := s.Read(ref.Base()); err != nil {
		t.Fatalf("reading a live attachment: %v", err)
	}

	// The line is deleted. The file goes to the trash, not to nothing.
	if gone, _, err := s.Sweep(Refs("# Holiday\n")); err != nil || gone != 1 {
		t.Fatalf("Sweep after removal = %d, %v; want 1, nil", gone, err)
	}

	// The edit is undone before the month is out, and the file comes back.
	if _, back, err := s.Sweep(referenced); err != nil || back != 1 {
		t.Fatalf("Sweep after undo = %d, %v; want 1, nil", back, err)
	}
	f, err := s.Read(ref.Base())
	if err != nil {
		t.Fatalf("reading a restored attachment: %v", err)
	}
	f.Close()

	// This time the removal sticks, and a month passes.
	if _, _, err := s.Sweep(Refs("# Holiday\n")); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-40 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(s.Dir(), ".trash", ref.Base()), old, old); err != nil {
		t.Fatal(err)
	}
	if n, err := s.PurgeExpired(30 * 24 * time.Hour); err != nil || n != 1 {
		t.Fatalf("PurgeExpired = %d, %v; want 1, nil", n, err)
	}
	if _, err := s.Read(ref.Base()); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound once it is really gone", err)
	}
}
```

Add `"time"` to the `attach_test.go` imports.

- [ ] **Step 2: Run the whole suite**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -v`
Expected: PASS.

- [ ] **Step 3: Check the package the way CI will**

```bash
export PATH="$HOME/.local/go/bin:$PATH"
go vet ./...
go test ./...
gofmt -l internal/attach/
git diff --stat main -- go.mod go.sum
```

Expected: vet silent, every package passing, `gofmt -l` printing nothing, and
the `go.mod`/`go.sum` diff empty — this PR adds no dependencies.

- [ ] **Step 4: Check the race detector, since two front ends will share this**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test -race ./internal/attach/`
Expected: PASS. If it reports a race, stop and report it rather than
papering over it with a mutex — the package holds no shared state by design,
so a race means something in the design is wrong.

- [ ] **Step 5: Commit and push**

```bash
git add internal/attach/
git commit -m "test the whole life of an attachment"
git fetch origin
git log --oneline HEAD..origin/main
```

If `main` has moved, rebase onto it before pushing. If a conflict is not
trivially resolvable, stop and ask rather than guessing.

```bash
git push -u origin attachments-store
```

- [ ] **Step 6: Open the pull request**

Body under 2000 characters, no attribution footer. It should cover: that this
is the first of four PRs and has no user-visible effect yet; that the bytes
live on disk beside the database; that names are content addresses, which is
what gives deduplication; that unreferenced files are trashed rather than
deleted, matching how notes behave; that `Markdown` and `Refs` are a matched
pair and why that matters; and that `go.mod` is unchanged.

Do not merge it.

---

## Self-Review

Checked against `docs/superpowers/specs/2026-09-16-attachments-design.md`:

**Spec coverage for PR A.** Directory beside the database — Task 1 creates the
layout, though the caller that derives it from the database path arrives in a
later PR, as the spec's delivery section intends. Content addressing and
deduplication — Task 2. Atomic write via `.tmp` and rename — Task 2. 50 MB cap
at the store boundary — Task 3. Deterministic extension from sniffed type —
Task 4. Image form versus link form — Task 5. `Refs` as the sole reader — Task
6. Name validation and traversal rejection — Task 7. Sweep in both directions,
trashed notes counting as references — Task 8 (the "all notes including
deleted" part is the caller's job, in PR B/C; `Sweep` only ever sees the set it
is handed). Purge on `TrashRetention` — Task 9, with retention as a parameter
so the caller supplies the shared constant.

**Out of scope here, by the spec's own delivery plan:** the HTTP routes, the
client drop and paste handlers, the TUI paste import, `nib gc`, the snapshot
tarball, and the documentation rewrite. Each belongs to PR B, C, or D.

**Two things this review changed:** `Store.Open` would have collided with the
package-level `Open`, so the reader is `Read` throughout, and Task 7's
interface block says why. `describe` needed a stub in Task 2 so that task's
tests can pass before Task 4 replaces it — without that the plan has a task
that cannot be run on its own, which defeats the point of the task boundaries.

**One thing left deliberately imperfect:** `Add` returns a `Ref` whose `Name`
is whatever the caller passed, unvalidated. It is never used to build a path —
only `Base()` is, and that is built from the id — so an adversarial name is
harmless here. PR B must still escape it before putting it in an HTTP header.
