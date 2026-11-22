package web

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/Prathmeshgumal/nib/internal/store"
)

func newTestServer(t *testing.T) (http.Handler, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "web.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return (&Server{store: st}).routes(), st
}

func do(t *testing.T, h http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decoding %q: %v", rec.Body.String(), err)
	}
	return v
}

func TestNotesCRUDOverHTTP(t *testing.T) {
	h, _ := newTestServer(t)

	rec := do(t, h, "POST", "/api/notes", map[string]string{"content": "# Hello\n\nbody"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create returned %d: %s", rec.Code, rec.Body)
	}
	created := decode[store.Note](t, rec)
	if created.Title != "Hello" {
		t.Errorf("title = %q, want it derived from the first line", created.Title)
	}

	rec = do(t, h, "PUT", "/api/notes/"+created.ID, map[string]string{"title": "Renamed", "content": "new"})
	if rec.Code != http.StatusOK {
		t.Fatalf("update returned %d", rec.Code)
	}
	if got := decode[store.Note](t, rec); got.Title != "Renamed" || got.Content != "new" {
		t.Errorf("update did not apply: %+v", got)
	}

	if rec = do(t, h, "GET", "/api/notes?q=renamed", nil); len(decode[[]store.Note](t, rec)) != 1 {
		t.Error("search did not find the note")
	}

	if rec = do(t, h, "DELETE", "/api/notes/"+created.ID, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete returned %d", rec.Code)
	}
	if rec = do(t, h, "GET", "/api/notes", nil); len(decode[[]store.Note](t, rec)) != 0 {
		t.Error("the deleted note is still listed")
	}
}

// Deleting over HTTP must be recoverable over HTTP too, or a browser-only user
// can destroy a note with no way back.
func TestTrashRoundTripOverHTTP(t *testing.T) {
	h, _ := newTestServer(t)

	created := decode[store.Note](t, do(t, h, "POST", "/api/notes", map[string]string{"content": "keep me"}))
	do(t, h, "DELETE", "/api/notes/"+created.ID, nil)

	rec := do(t, h, "GET", "/api/trash", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("listing the trash returned %d", rec.Code)
	}
	trash := decode[[]store.Note](t, rec)
	if len(trash) != 1 || trash[0].ID != created.ID {
		t.Fatalf("trash = %v, want the deleted note", trash)
	}

	rec = do(t, h, "POST", "/api/trash/"+created.ID, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("restore returned %d: %s", rec.Code, rec.Body)
	}
	if got := decode[store.Note](t, rec); got.Content != "keep me" {
		t.Errorf("restored note came back changed: %+v", got)
	}
	if len(decode[[]store.Note](t, do(t, h, "GET", "/api/notes", nil))) != 1 {
		t.Error("the restored note is not listed again")
	}
	if len(decode[[]store.Note](t, do(t, h, "GET", "/api/trash", nil))) != 0 {
		t.Error("the note is still in the trash after restoring")
	}
}

func TestPurgeAndEmptyOverHTTP(t *testing.T) {
	h, _ := newTestServer(t)

	one := decode[store.Note](t, do(t, h, "POST", "/api/notes", map[string]string{"content": "one"}))
	two := decode[store.Note](t, do(t, h, "POST", "/api/notes", map[string]string{"content": "two"}))
	live := decode[store.Note](t, do(t, h, "POST", "/api/notes", map[string]string{"content": "live"}))
	do(t, h, "DELETE", "/api/notes/"+one.ID, nil)
	do(t, h, "DELETE", "/api/notes/"+two.ID, nil)

	if rec := do(t, h, "DELETE", "/api/trash/"+one.ID, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("purge returned %d", rec.Code)
	}
	// Purged for good: it can no longer be restored.
	if rec := do(t, h, "POST", "/api/trash/"+one.ID, nil); rec.Code != http.StatusNotFound {
		t.Errorf("a purged note was restorable, got %d", rec.Code)
	}

	rec := do(t, h, "DELETE", "/api/trash", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("empty returned %d", rec.Code)
	}
	if n := decode[map[string]int](t, rec)["deleted"]; n != 1 {
		t.Errorf("emptied %d notes, want 1", n)
	}
	notes := decode[[]store.Note](t, do(t, h, "GET", "/api/notes", nil))
	if len(notes) != 1 || notes[0].ID != live.ID {
		t.Errorf("emptying the trash touched a live note: %v", notes)
	}
}

// A live note must not be destroyable through the trash routes.
func TestTrashRoutesRefuseLiveNotes(t *testing.T) {
	h, _ := newTestServer(t)
	live := decode[store.Note](t, do(t, h, "POST", "/api/notes", map[string]string{"content": "live"}))

	if rec := do(t, h, "DELETE", "/api/trash/"+live.ID, nil); rec.Code != http.StatusNotFound {
		t.Errorf("purging a live note returned %d, want 404", rec.Code)
	}
	if rec := do(t, h, "POST", "/api/trash/"+live.ID, nil); rec.Code != http.StatusNotFound {
		t.Errorf("restoring a live note returned %d, want 404", rec.Code)
	}
	if len(decode[[]store.Note](t, do(t, h, "GET", "/api/notes", nil))) != 1 {
		t.Error("the live note was affected")
	}
}

func TestUnknownIDsAndMethods(t *testing.T) {
	h, _ := newTestServer(t)

	for _, tc := range []struct {
		method, path string
		want         int
	}{
		{"GET", "/api/notes/nope", http.StatusNotFound},
		{"POST", "/api/trash/nope", http.StatusNotFound},
		{"DELETE", "/api/trash/nope", http.StatusNotFound},
		{"PATCH", "/api/notes", http.StatusMethodNotAllowed},
		{"PATCH", "/api/trash", http.StatusMethodNotAllowed},
		{"PUT", "/api/trash/x", http.StatusMethodNotAllowed},
	} {
		if rec := do(t, h, tc.method, tc.path, nil); rec.Code != tc.want {
			t.Errorf("%s %s returned %d, want %d", tc.method, tc.path, rec.Code, tc.want)
		}
	}
}

// The bug: renaming a note in one interface while the other had it open. The
// other's next save of the body carried its old title and put it back - and a
// blank one came back as the first line. A save without a title is a save of
// the body alone.
func TestSavingTheBodyKeepsAChosenTitle(t *testing.T) {
	h, _ := newTestServer(t)
	created := decode[store.Note](t, do(t, h, "POST", "/api/notes", map[string]string{"content": "shopping list"}))

	do(t, h, "PUT", "/api/notes/"+created.ID, map[string]string{"title": "Groceries", "content": "shopping list"})
	rec := do(t, h, "PUT", "/api/notes/"+created.ID, map[string]string{"content": "shopping list and eggs"})
	got := decode[store.Note](t, rec)
	if got.Title != "Groceries" || !got.TitleSet {
		t.Errorf("title = %q set=%v, want the chosen title kept", got.Title, got.TitleSet)
	}
	if got.Content != "shopping list and eggs" {
		t.Errorf("content = %q, want the new body", got.Content)
	}

	// An explicit blank title hands the name back to the first line.
	rec = do(t, h, "PUT", "/api/notes/"+created.ID, map[string]string{"title": "", "content": "eggs"})
	if got := decode[store.Note](t, rec); got.Title != "eggs" || got.TitleSet {
		t.Errorf("title = %q set=%v, want the first line again", got.Title, got.TitleSet)
	}
}
