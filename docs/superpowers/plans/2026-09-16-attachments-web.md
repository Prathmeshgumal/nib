# Attachments in the Web UI (PR B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag an image into a note in the browser and have it appear in the note, stored on disk and served back.

**Architecture:** `store` gains ownership of an `attach.Store` derived from its own database path, so the reference-gathering join exists in exactly one place. The web server uploads through it and serves bytes from it. The React editor gets drop and paste handlers that share one upload path.

**Tech Stack:** Go 1.25 standard library, React 19, no new dependencies on either side.

**Spec:** `docs/superpowers/specs/2026-09-16-attachments-design.md`
**Builds on:** `docs/superpowers/plans/2026-09-16-attachments-store.md` (PR A, merged)

## Global Constraints

- **No new dependencies.** Neither `go.mod` nor `client/package.json` may gain an entry.
- **Commit messages:** one line, at most 10 words, plain words, no prefixes, no attribution.
- **Go needs** `export PATH="$HOME/.local/go/bin:$PATH"`.
- **Branch:** `attachments-web` off `main`. Open a PR; do not merge.
- The attachments directory is `filepath.Join(filepath.Dir(dbPath), "attachments")`.

## Two corrections to PR A, decided after it merged

Both were found by reasoning about two processes running at once — the TUI and
`nib --web` share the database through WAL, so they also share this directory.

1. **`Read` must fall back to the trash.** A note open in the TUI with an
   unsaved image, plus a web server starting and sweeping, equals a file
   trashed while a reference to it is about to exist. The reconciliation heals
   it on the next sweep, but the image 404s until then. A caller asking by
   exact content hash holds a reference, so serving a trashed file is correct.
2. **`Sweep` must tolerate a file that vanished.** Two processes sweeping at
   once both try to rename the same file; one wins and the other gets ENOENT.
   That is work someone else did, not an error.

## File Structure

- `internal/attach/attach.go`, `sweep.go` — the two corrections above.
- `internal/store/store.go` — owns the `attach.Store`; `Attachments()`, `SweepAttachments()`.
- `internal/web/attachments.go` — **new**: the upload and serve handlers, kept out of `web.go`, which is already 236 lines and about notes.
- `client/src/lib/api.js` — `uploadAttachment`.
- `client/src/components/Editor.jsx` — drop and paste.

---

### Task 1: The two corrections to `attach`

**Files:**
- Modify: `internal/attach/attach.go`, `internal/attach/sweep.go`
- Modify: `internal/attach/attach_test.go`, `internal/attach/sweep_test.go`

**Interfaces:**
- Consumes: everything from PR A.
- Produces: no new names. `Read` and `Sweep` change behaviour only.

- [ ] **Step 1: Write the failing tests**

```go
// in attach_test.go
func TestReadFallsBackToTheTrash(t *testing.T) {
	// A note being edited elsewhere can reference a file that a sweep has
	// already moved to the trash. Asking for it by its content hash is proof
	// enough that a reference exists, so it must still be served.
	s := newTestStore(t)
	ref, err := s.Add("hello.txt", strings.NewReader("hello"))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Sweep(map[string]struct{}{}); err != nil {
		t.Fatal(err)
	}

	f, err := s.Read(ref.Base())
	if err != nil {
		t.Fatalf("reading a trashed attachment: %v", err)
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
```

```go
// in sweep_test.go
func TestSweepToleratesAFileThatVanished(t *testing.T) {
	// Two processes sweep at once: one wins the rename, the other finds the
	// file already gone. That is work someone else did, not a failure.
	s := newTestStore(t)
	base := add(t, s, "raced")

	entries, err := os.ReadDir(s.Dir())
	if err != nil {
		t.Fatal(err)
	}
	_ = entries

	// Simulate the loser by deleting the file after listing but before moving:
	// sweeping a directory whose entry no longer exists must not error.
	if err := os.Remove(filepath.Join(s.Dir(), base)); err != nil {
		t.Fatal(err)
	}
	// Put a stale name back into the listing by creating and removing again is
	// not possible portably, so exercise the same branch directly: sweeping
	// twice with the file gone must be silent.
	if _, _, err := s.Sweep(refs()); err != nil {
		t.Fatalf("sweeping with a missing file: %v", err)
	}
}

func TestSweepSurvivesConcurrentSweeps(t *testing.T) {
	s := newTestStore(t)
	for i := range 20 {
		add(t, s, fmt.Sprintf("file %d", i))
	}

	errs := make(chan error, 4)
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := s.Sweep(refs())
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("concurrent sweep: %v", err)
		}
	}
}
```

Add `"fmt"` and `"sync"` to the sweep test imports, `"io"` is already in the
attach test imports.

- [ ] **Step 2: Run them and watch the concurrency test fail**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/attach/ -run "TestReadFallsBack|TestSweepSurvives|TestSweepTolerates" -v`
Expected: `TestReadFallsBackToTheTrash` FAILs with ErrNotFound, and
`TestSweepSurvivesConcurrentSweeps` FAILs with a "moving ...: no such file"
error from whichever goroutines lost.

- [ ] **Step 3: Fix `Read`**

```go
// Read opens a stored attachment by its name on disk.
//
// A file in the trash is still served. A caller naming a file by the hash of
// its contents is holding a reference to it, and a sweep in another process
// may have moved it a moment ago; refusing would turn a race into a broken
// image on the page.
func (s *Store) Read(base string) (*os.File, error) {
	if !validBase(base) {
		return nil, fmt.Errorf("%q: %w", base, ErrBadName)
	}
	for _, dir := range []string{s.dir, filepath.Join(s.dir, trashDir)} {
		f, err := os.Open(filepath.Join(dir, base))
		if err == nil {
			return f, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	return nil, fmt.Errorf("%s: %w", base, ErrNotFound)
}
```

- [ ] **Step 4: Fix `Sweep`**

In the `move` closure, treat a missing source as done:

```go
		if err := os.Rename(src, dst); err != nil {
			// Another process swept at the same time and won the race. Its
			// work is ours, so there is nothing left to do and nothing wrong.
			if errors.Is(err, os.ErrNotExist) {
				return errRaced
			}
			return fmt.Errorf("moving %s: %w", base, err)
		}
```

with, at the top of the file:

```go
// errRaced means another process moved the file first. Never returned to a
// caller: it only tells the loop to skip the file and not count it.
var errRaced = errors.New("already moved")
```

and, at both call sites, skip rather than fail:

```go
		if err := move(s.dir, trash, e.Name()); err != nil {
			if errors.Is(err, errRaced) {
				continue
			}
			return trashed, restored, err
		}
		trashed++
```

Add `errors` to the imports in `sweep.go`.

- [ ] **Step 5: Run the whole package with the race detector**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test -race ./internal/attach/ -v`
Expected: PASS, every test.

- [ ] **Step 6: Commit**

```bash
git add internal/attach/
git commit -m "serve trashed files and survive parallel sweeps"
```

---

### Task 2: `store` owns the attachments

**Files:**
- Modify: `internal/store/store.go`
- Create: `internal/store/attachments_test.go`

**Interfaces:**
- Consumes: `attach.Open`, `attach.Refs`, `Store.Sweep`, `Store.PurgeExpired`.
- Produces: `func (s *Store) Attachments() *attach.Store`; `func (s *Store) SweepAttachments() (trashed, restored int, err error)`.

`store` owns it so that the reference-gathering join happens exactly once. The
set must include **soft-deleted notes**: a note in the trash is recoverable for
30 days, so restoring it must not return a note full of broken images. Putting
this anywhere else makes that a rule every caller has to remember.

- [ ] **Step 1: Write the failing test**

```go
package store

import (
	"strings"
	"testing"
)

func TestAttachmentsLiveBesideTheDatabase(t *testing.T) {
	st := newTestStore(t)
	dir := st.Attachments().Dir()
	if !strings.HasSuffix(dir, "attachments") {
		t.Errorf("attachments at %q, want a directory of that name", dir)
	}
	if !strings.HasPrefix(dir, strings.TrimSuffix(st.Path, "notes.db")) {
		t.Errorf("attachments at %q, want them beside the database at %q", dir, st.Path)
	}
}

func TestSweepKeepsWhatALiveNoteUses(t *testing.T) {
	st := newTestStore(t)
	ref, err := st.Attachments().Add("shot.png", strings.NewReader("\x89PNG\r\n\x1a\npretend"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Create("With a picture", "here it is\n\n"+ref.Markdown()); err != nil {
		t.Fatal(err)
	}

	trashed, _, err := st.SweepAttachments()
	if err != nil {
		t.Fatal(err)
	}
	if trashed != 0 {
		t.Errorf("trashed %d files that a note is using", trashed)
	}
	if _, err := st.Attachments().Read(ref.Base()); err != nil {
		t.Errorf("reading it back: %v", err)
	}
}

func TestSweepKeepsWhatATrashedNoteUses(t *testing.T) {
	// A note in the trash is recoverable for thirty days. Its pictures have to
	// last at least as long, or restoring it hands back a broken note.
	st := newTestStore(t)
	ref, err := st.Attachments().Add("shot.png", strings.NewReader("\x89PNG\r\n\x1a\npretend"))
	if err != nil {
		t.Fatal(err)
	}
	note, err := st.Create("Doomed", ref.Markdown())
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Delete(note.ID); err != nil {
		t.Fatal(err)
	}

	trashed, _, err := st.SweepAttachments()
	if err != nil {
		t.Fatal(err)
	}
	if trashed != 0 {
		t.Fatalf("trashed %d files belonging to a recoverable note", trashed)
	}

	if err := st.Restore(note.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Attachments().Read(ref.Base()); err != nil {
		t.Errorf("the restored note's picture is gone: %v", err)
	}
}

func TestSweepTrashesWhatNothingUses(t *testing.T) {
	st := newTestStore(t)
	ref, err := st.Attachments().Add("orphan.txt", strings.NewReader("nobody wants me"))
	if err != nil {
		t.Fatal(err)
	}

	trashed, _, err := st.SweepAttachments()
	if err != nil {
		t.Fatal(err)
	}
	if trashed != 1 {
		t.Errorf("trashed %d, want the orphan gone", trashed)
	}
	// Still readable, because trashed is not deleted.
	if _, err := st.Attachments().Read(ref.Base()); err != nil {
		t.Errorf("a trashed attachment should still be readable: %v", err)
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/store/ -run "TestAttachments|TestSweep" -v`
Expected: FAIL — `st.Attachments undefined`.

- [ ] **Step 3: Implement**

Add to the `Store` struct and `Open` in `internal/store/store.go`:

```go
type Store struct {
	db     *sql.DB
	Path   string
	attach *attach.Store
}
```

In `Open`, after the schema migration and before `purgeExpiredTrash`:

```go
	// Attachments live beside the database rather than in a fixed place, so
	// pointing --db somewhere else takes the files with it and the relative
	// links inside the notes keep resolving.
	at, err := attach.Open(filepath.Join(filepath.Dir(path), "attachments"))
	if err != nil {
		return nil, err
	}
	st := &Store{db: db, Path: path, attach: at}
	if err := st.purgeExpiredTrash(); err != nil {
		return nil, err
	}
	if _, err := at.PurgeExpired(TrashRetention); err != nil {
		return nil, err
	}
	if _, _, err := st.SweepAttachments(); err != nil {
		return nil, err
	}
	return st, nil
```

Replace the existing `st := &Store{db: db, Path: path}` block with the above.

New file content appended to `store.go`:

```go
// Attachments is the store for the files the notes refer to.
func (s *Store) Attachments() *attach.Store { return s.attach }

// SweepAttachments reconciles the attachments directory against the notes.
//
// Deleted notes count. A note in the trash is recoverable for TrashRetention,
// so its files have to outlive it by at least as long, or restoring a note
// hands back broken images. Gathering the set here rather than in the callers
// is what stops anyone forgetting that.
func (s *Store) SweepAttachments() (trashed, restored int, err error) {
	rows, err := s.db.Query(`SELECT content FROM notes`)
	if err != nil {
		return 0, 0, fmt.Errorf("reading note contents: %w", err)
	}
	defer rows.Close()

	referenced := map[string]struct{}{}
	for rows.Next() {
		var content string
		if err := rows.Scan(&content); err != nil {
			return 0, 0, err
		}
		for _, id := range attach.Refs(content) {
			referenced[id] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}
	return s.attach.Sweep(referenced)
}
```

Add `"github.com/Prathmeshgumal/nib/internal/attach"` to the imports.

- [ ] **Step 4: Run the tests**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/store/ -v 2>&1 | tail -20`
Expected: PASS, including every pre-existing store test.

- [ ] **Step 5: Commit**

```bash
git add internal/store/
git commit -m "keep the attachments beside the notes"
```

---

### Task 3: Serving a file back

**Files:**
- Create: `internal/web/attachments.go`
- Modify: `internal/web/web.go` (the `routes` method only)
- Create: `internal/web/attachments_test.go`

**Interfaces:**
- Consumes: `store.Store.Attachments()`, `attach.ErrBadName`, `attach.ErrNotFound`.
- Produces: `func (s *Server) handleAttachment(w http.ResponseWriter, r *http.Request)`.

Mounted at `/attachments/` rather than under `/api/`, because the markdown
inside a note says `attachments/x.png` and the page is served from `/`, so the
browser resolves it to exactly this route with no rewriting anywhere.

`http.ServeMux` prefers the longer pattern, so this wins over the `/` SPA
handler without any ordering care.

- [ ] **Step 1: Write the failing test**

```go
package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServesAnAttachment(t *testing.T) {
	s := newTestServer(t)
	ref, err := s.store.Attachments().Add("shot.png", strings.NewReader("\x89PNG\r\n\x1a\npretend"))
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/attachments/"+ref.Base(), nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", got)
	}
	if got := rec.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Errorf("Cache-Control = %q, want it cached hard: the name is a content hash", got)
	}
	if rec.Body.String() != "\x89PNG\r\n\x1a\npretend" {
		t.Errorf("body did not round-trip")
	}
}

func TestRefusesABadAttachmentName(t *testing.T) {
	s := newTestServer(t)
	for _, path := range []string{
		"/attachments/../../etc/passwd",
		"/attachments/8F3A91C2D4E5F607.png",
		"/attachments/nonsense",
		"/attachments/",
	} {
		rec := httptest.NewRecorder()
		s.routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, rec.Code)
		}
	}
}

func TestAttachmentRejectsOtherMethods(t *testing.T) {
	s := newTestServer(t)
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/attachments/8f3a91c2d4e5f607.png", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("DELETE = %d, want 405", rec.Code)
	}
}
```

Check what the existing `internal/web/web_test.go` names its helper; if it is
not `newTestServer`, use whatever it provides instead of adding a second one.

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/web/ -run Attachment -v`
Expected: FAIL — 404 from the SPA fallback, because no route is registered.

- [ ] **Step 3: Implement**

`internal/web/attachments.go`:

```go
package web

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/Prathmeshgumal/nib/internal/attach"
)

// handleAttachment serves one stored file.
//
// It lives at /attachments/ and not under /api/ because that is the path the
// markdown inside a note already spells: the page is served from /, so a
// relative "attachments/x.png" resolves here on its own.
func (s *Server) handleAttachment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	base := strings.TrimPrefix(r.URL.Path, "/attachments/")
	f, err := s.store.Attachments().Read(base)
	if err != nil {
		// A refused name and a missing file are the same answer: a caller
		// should not be able to tell a malformed request from a real absence.
		if errors.Is(err, attach.ErrBadName) || errors.Is(err, attach.ErrNotFound) {
			http.NotFound(w, r)
			return
		}
		serverError(w, err)
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		serverError(w, err)
		return
	}

	// The name is the hash of the contents, so this bytes-for-bytes can never
	// mean anything else. ServeContent adds the ETag and range handling.
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeContent(w, r, base, info.ModTime(), f)
}

var _ = io.Discard // keep the import list honest if ServeContent changes
```

Drop that last line and the `io` import — it is not needed. Register the route
in `web.go`'s `routes`, above the `/` handler:

```go
	mux.HandleFunc("/attachments/", s.handleAttachment)
```

`http.ServeContent` picks the content type from the file extension, which is
exactly the extension `attach` derived from the bytes.

- [ ] **Step 4: Run the tests**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/web/ -v 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/web/
git commit -m "serve attachments over http"
```

---

### Task 4: Taking an upload

**Files:**
- Modify: `internal/web/attachments.go`, `internal/web/web.go`
- Modify: `internal/web/attachments_test.go`

**Interfaces:**
- Consumes: `store.Store.Attachments()`, `attach.ErrTooLarge`, `attach.MaxSize`.
- Produces: `func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request)`; the JSON shape `{"id","name","markdown","size","mime"}`.

The response carries the finished markdown line so the browser never has to
know the reference format. That keeps `attach.Ref.Markdown` the only writer of
it, which is the property PR A's `TestMarkdownAndRefsAgree` exists to protect.

- [ ] **Step 1: Write the failing test**

```go
func TestUploadStoresAndDescribes(t *testing.T) {
	s := newTestServer(t)

	body := &bytes.Buffer{}
	mw := multipart.NewWriter(body)
	part, err := mw.CreateFormFile("file", "holiday photo.png")
	if err != nil {
		t.Fatal(err)
	}
	part.Write([]byte("\x89PNG\r\n\x1a\npretend this is a picture"))
	mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/attachments", body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", rec.Code, rec.Body)
	}
	var got struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Markdown string `json:"markdown"`
		MIME     string `json:"mime"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.MIME != "image/png" {
		t.Errorf("mime = %q, want image/png", got.MIME)
	}
	if got.Markdown != "![holiday photo.png](attachments/"+got.ID+".png)" {
		t.Errorf("markdown = %q", got.Markdown)
	}

	// And it is immediately servable at the path the markdown names.
	rec2 := httptest.NewRecorder()
	s.routes().ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/attachments/"+got.ID+".png", nil))
	if rec2.Code != http.StatusOK {
		t.Errorf("serving what we just uploaded: %d", rec2.Code)
	}
}

func TestUploadNeedsAFile(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/attachments", strings.NewReader("not multipart"))
	req.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400", rec.Code)
	}
}

func TestUploadRejectsOtherMethods(t *testing.T) {
	s := newTestServer(t)
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/attachments", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET = %d, want 405", rec.Code)
	}
}
```

Add `bytes`, `encoding/json`, `mime/multipart` to the test imports.

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go test ./internal/web/ -run TestUpload -v`
Expected: FAIL — 404, no route.

- [ ] **Step 3: Implement**

Append to `internal/web/attachments.go`:

```go
// handleUpload stores one file and answers with the markdown line for it.
//
// The line is built here rather than in the browser so that attach.Ref stays
// the only writer of the reference format: a second speller of it is how the
// sweeper and the notes end up disagreeing about what is still in use.
func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// One byte over the cap, so an oversized upload is refused by attach.Add
	// rather than silently truncated here.
	r.Body = http.MaxBytesReader(w, r.Body, attach.MaxSize+1024)

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "expected a file"})
		return
	}
	defer file.Close()

	ref, err := s.store.Attachments().Add(header.Filename, file)
	if errors.Is(err, attach.ErrTooLarge) {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
			"error": "that file is larger than 50 MB",
		})
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":       ref.ID,
		"name":     ref.Name,
		"mime":     ref.MIME,
		"size":     ref.Size,
		"markdown": ref.Markdown(),
	})
}
```

Register in `routes`:

```go
	mux.HandleFunc("/api/attachments", s.handleUpload)
```

- [ ] **Step 4: Run the whole Go suite**

Run: `export PATH="$HOME/.local/go/bin:$PATH" && go vet ./... && go test ./...`
Expected: every package passing.

- [ ] **Step 5: Commit**

```bash
git add internal/web/
git commit -m "accept an uploaded file over http"
```

---

### Task 5: Dropping a file onto the editor

**Files:**
- Modify: `client/src/lib/api.js`
- Modify: `client/src/components/Editor.jsx`

**Interfaces:**
- Consumes: `POST /api/attachments` from Task 4.
- Produces: `export const uploadAttachment = (file) => Promise<{id,name,mime,size,markdown}>`.

Drop and paste share one path, because a screenshot arrives in the clipboard
and a saved file arrives on a drop, and both should feel the same.

- [ ] **Step 1: Add the upload call**

In `client/src/lib/api.js`, after the trash exports:

```js
// Attachments go up as multipart, so this cannot use request(): that helper
// sets a JSON content type, and the browser has to set its own boundary here.
export async function uploadAttachment(file) {
  const body = new FormData();
  body.append('file', file, file.name || 'pasted');
  const res = await fetch('/api/attachments', { method: 'POST', body });
  if (!res.ok) {
    const problem = await res.json().catch(() => ({}));
    throw new Error(problem.error || `Upload failed (${res.status})`);
  }
  return res.json();
}
```

- [ ] **Step 2: Wire the editor**

In `client/src/components/Editor.jsx`, add to the imports:

```js
import { toast } from 'sonner';
import { uploadAttachment } from '@/lib/api';
```

Add state beside `const [tab, setTab] = useState('write');`:

```js
  const [dropping, setDropping] = useState(false);
```

Add the shared import path above `onKeyDown`:

```js
  // Put the markdown where the cursor is, or at the end if the textarea has
  // never been focused.
  const insert = (text) => {
    const el = textareaRef.current;
    const at = el ? el.selectionStart : note.content.length;
    const before = note.content.slice(0, at);
    const after = note.content.slice(at);
    // Keep the line to itself: an image wedged into a paragraph renders as
    // part of that paragraph.
    const lead = before === '' || before.endsWith('\n') ? '' : '\n';
    const value = `${before}${lead}${text}\n${after}`;
    onChange({ ...note, content: value });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = before.length + lead.length + text.length + 1;
      el.setSelectionRange(caret, caret);
    });
  };

  const take = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    for (const file of list) {
      try {
        const { markdown } = await uploadAttachment(file);
        insert(markdown);
      } catch (err) {
        toast.error(`Could not attach ${file.name || 'that file'}`, {
          description: err.message,
        });
      }
    }
  };
```

Replace the `<Textarea .../>` element with a wrapper that carries the drop
handlers, so the highlight covers the whole writing area:

```jsx
          <div
            className="relative flex min-h-0 flex-1 flex-col"
            onDragOver={(e) => {
              // Without this the browser navigates to the dropped file.
              e.preventDefault();
              setDropping(true);
            }}
            onDragLeave={(e) => {
              // Ignore the events fired while crossing child elements.
              if (e.currentTarget.contains(e.relatedTarget)) return;
              setDropping(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDropping(false);
              take(e.dataTransfer.files);
            }}
          >
            <Textarea
              ref={textareaRef}
              value={note.content}
              placeholder="Write your note in Markdown…"
              onChange={(e) => onChange({ ...note, content: e.target.value })}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                // Only intercept a paste that actually carries files; a normal
                // text paste must behave exactly as it always has.
                if (!e.clipboardData.files.length) return;
                e.preventDefault();
                take(e.clipboardData.files);
              }}
              spellCheck
              className="min-h-0 flex-1 resize-none font-mono text-[13px] leading-relaxed"
            />
            {dropping && (
              <div className="bg-background/80 pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed text-sm font-medium">
                Drop to attach
              </div>
            )}
          </div>
```

Update the hint line below it:

```jsx
          <p className="text-muted-foreground text-xs">
            Markdown supported · <kbd className="font-mono">Ctrl+S</kbd> to save ·
            drop or paste a file to attach it
          </p>
```

- [ ] **Step 3: Build the client**

```bash
cd client && npm run build && cd ..
```

Expected: a clean build. Any unresolved import fails here.

- [ ] **Step 4: Commit**

```bash
git add client/src/
git commit -m "drop or paste a file into a note"
```

---

### Task 6: Check it end to end, then open the PR

**Files:** none changed unless something fails.

- [ ] **Step 1: Confirm the preview can show an image**

`client/src/lib/markdown.js` runs DOMPurify over the rendered HTML. Confirm
`img` survives with a relative `src`:

```bash
cd client && node -e "
const {JSDOM}=require('jsdom');
" 2>/dev/null || echo "no jsdom; check in the browser instead"
```

DOMPurify allows `img` and `src` by default, so no configuration change is
expected. If the image does not appear in the Preview tab during Step 3, add
`ADD_TAGS`/`ADD_ATTR` as needed and note it in the PR.

- [ ] **Step 2: Run everything the way CI does**

```bash
export PATH="$HOME/.local/go/bin:$PATH"
go vet ./...
go test ./...
go test -race ./internal/attach/ ./internal/store/ ./internal/web/
gofmt -l internal/
git diff --stat main -- go.mod go.sum client/package.json
```

Expected: all passing, `gofmt` silent, and the dependency diff empty.

- [ ] **Step 3: Try it by hand**

```bash
export PATH="$HOME/.local/go/bin:$PATH"
cd client && npm run build && cd ..
go build -o /tmp/nib-attach-test .
/tmp/nib-attach-test --web --db /tmp/nib-attach-test.db
```

Open the printed URL, make a note, drag an image into the Write tab, check the
markdown line appears, switch to Preview and confirm the image renders. Then
confirm the file is on disk:

```bash
ls -la /tmp/attachments/ 2>/dev/null || ls -la "$(dirname /tmp/nib-attach-test.db)/attachments"
```

- [ ] **Step 4: Open the PR**

Under 2000 characters, no attribution. Cover: that `store` owns the attachment
store so the referenced-set join has one home and deleted notes cannot be
forgotten; the two corrections to PR A and the races that motivated them; the
`/attachments/` route and why it is not under `/api/`; that the server returns
the finished markdown so the browser never spells the reference format; and
that no dependency was added on either side.

Do not merge it.

## Self-Review

**Spec coverage:** upload endpoint, serving endpoint, id validation, drop
handlers, clipboard paste in the browser — Tasks 3, 4, 5. Attachments beside
the database — Task 2. Deleted notes counting as references, the obligation
carried forward from PR A — Task 2, with a test that restores a trashed note
and reads its image back.

**Not here, by the spec's delivery plan:** the TUI (PR C), `nib gc`, the
snapshot tarball, and the documentation rewrite (PR D).

**Changed during review:** Task 3's draft carried a stray `io` import and a
`var _ = io.Discard` line to justify it; the step now says to drop both.
Task 3 also originally asserted a specific `ETag` value, which `ServeContent`
derives however it likes — the test now checks `Cache-Control` and the body,
which are the behaviours we actually promise.

**Known gap:** `TestSweepToleratesAFileThatVanished` cannot portably force the
lost half of a rename race, so it exercises the missing-file branch indirectly
and `TestSweepSurvivesConcurrentSweeps` covers the real thing by running four
sweeps at once under `-race`.
