package syncer

import (
	"bytes"
	"context"
	"database/sql"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/Prathmeshgumal/nib/internal/store"
	"github.com/Prathmeshgumal/nib/internal/web"
)

const testPass = "correct horse battery"

// hosted starts a server the way `nib serve` does and returns its address.
// Its store is Postgres when NIB_TEST_POSTGRES is set, SQLite otherwise: the
// server's behaviour does not depend on which.
func hosted(t *testing.T) string {
	t.Helper()
	var (
		st  *store.Store
		err error
	)
	if url := os.Getenv("NIB_TEST_POSTGRES"); url != "" {
		st, err = store.OpenPostgres(url)
		if err == nil {
			err = truncate(url)
		}
	} else {
		st, err = store.Open(filepath.Join(t.TempDir(), "server.db"))
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	srv, err := web.NewHosted(st, "127.0.0.1:0", web.NewAuth("me", testPass))
	if err != nil {
		t.Fatal(err)
	}
	srv.Start()
	t.Cleanup(func() { srv.Stop() })
	return srv.URL
}

// truncate empties the scratch Postgres database between tests.
func truncate(url string) error {
	db, err := sql.Open("pgx", url)
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.Exec(`TRUNCATE notes, tombstones, meta, attachments`)
	return err
}

func device(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "nib.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func client(t *testing.T, url string) *Client {
	t.Helper()
	c, err := New(Remote{URL: url, User: "me", Password: testPass})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func sync(t *testing.T, c *Client, st *store.Store) Result {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	res, err := c.Sync(ctx, st)
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	return res
}

func titles(t *testing.T, st *store.Store) []string {
	t.Helper()
	notes, err := st.List("")
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, n := range notes {
		out = append(out, n.Title+"="+n.Content)
	}
	return out
}

func TestTwoDevicesConverge(t *testing.T) {
	url := hosted(t)
	a, b := device(t), device(t)
	ca, cb := client(t, url), client(t, url)

	// A writes, with a picture, and syncs. B then sees both.
	png := []byte("\x89PNG\r\n\x1a\n pretend image bytes")
	ref, err := a.Blobs().Add("shot.png", bytes.NewReader(png))
	if err != nil {
		t.Fatal(err)
	}
	note, _ := a.Create("Trip", "# Trip\n\n"+ref.Markdown())
	if res := sync(t, ca, a); res.Sent != 1 || res.Uploaded != 1 {
		t.Errorf("first sync = %+v, want 1 note and 1 file sent", res)
	}
	if res := sync(t, cb, b); res.Received != 1 || res.Downloaded != 1 {
		t.Errorf("B's sync = %+v, want 1 note and 1 file received", res)
	}
	got, err := b.Get(note.ID)
	if err != nil || got.Title != "Trip" {
		t.Fatalf("B has %+v, %v", got, err)
	}
	f, _, err := b.Blobs().Open(ref.Base())
	if err != nil {
		t.Fatalf("the picture did not reach B: %v", err)
	}
	data, _ := io.ReadAll(f)
	f.Close()
	if !bytes.Equal(data, png) {
		t.Error("the picture changed in transit")
	}

	// B edits; A sees it.
	if _, err := b.Update(note.ID, "Trip", "# Trip\n\nedited on B"); err != nil {
		t.Fatal(err)
	}
	sync(t, cb, b)
	sync(t, ca, a)
	if got, _ := a.Get(note.ID); !strings.Contains(got.Content, "edited on B") {
		t.Errorf("A did not receive B's edit: %q", got.Content)
	}

	// A trashes it; B sees it in the trash, not the list.
	a.Delete(note.ID)
	sync(t, ca, a)
	sync(t, cb, b)
	if _, err := b.Get(note.ID); err == nil {
		t.Error("the trashed note is still live on B")
	}
	if trash, _ := b.Trash(); len(trash) != 1 {
		t.Errorf("B's trash has %d notes, want 1", len(trash))
	}

	// B restores it; A gets it back.
	b.Restore(note.ID)
	sync(t, cb, b)
	sync(t, ca, a)
	if _, err := a.Get(note.ID); err != nil {
		t.Errorf("the restored note did not reach A: %v", err)
	}

	// A destroys it for good; it must vanish from B and stay gone.
	a.Delete(note.ID)
	a.Purge(note.ID)
	sync(t, ca, a)
	sync(t, cb, b)
	if _, err := b.Get(note.ID); err == nil {
		t.Error("a purged note survived on B")
	}
	if trash, _ := b.Trash(); len(trash) != 0 {
		t.Errorf("B's trash has %d notes after the purge, want 0", len(trash))
	}
	sync(t, ca, a)
	if got := titles(t, a); len(got) != 0 {
		t.Errorf("A's notes after everything = %v, want none", got)
	}
}

func TestSecondSyncSendsNothing(t *testing.T) {
	url := hosted(t)
	a := device(t)
	c := client(t, url)
	a.Create("One", "1")
	a.Create("Two", "2")
	if res := sync(t, c, a); res.Sent != 2 {
		t.Fatalf("first sync sent %d, want 2", res.Sent)
	}
	if res := sync(t, c, a); res.Sent != 0 {
		t.Errorf("an idle sync sent %d notes", res.Sent)
	}
}

func TestLastWriteWinsOnConflict(t *testing.T) {
	url := hosted(t)
	a, b := device(t), device(t)
	ca, cb := client(t, url), client(t, url)

	n, _ := a.Create("Shared", "start")
	sync(t, ca, a)
	sync(t, cb, b)

	// Both edit while apart. B's edit comes second.
	a.Update(n.ID, "Shared", "from A")
	time.Sleep(5 * time.Millisecond)
	b.Update(n.ID, "Shared", "from B")

	// B reaches the server first, then A: the later write must still win,
	// not the one that arrived last.
	sync(t, cb, b)
	sync(t, ca, a)
	sync(t, cb, b)
	for name, st := range map[string]*store.Store{"A": a, "B": b} {
		if got, _ := st.Get(n.ID); got.Content != "from B" {
			t.Errorf("%s ended with %q, want the later edit %q", name, got.Content, "from B")
		}
	}
}

func TestFirstSyncFromANewDeviceBringsEverything(t *testing.T) {
	url := hosted(t)
	a, fresh := device(t), device(t)
	for _, title := range []string{"x", "y", "z"} {
		a.Create(title, title)
	}
	sync(t, client(t, url), a)
	if res := sync(t, client(t, url), fresh); res.Received != 3 {
		t.Errorf("a new device received %d notes, want 3", res.Received)
	}
}

func TestWrongPasswordIsRefused(t *testing.T) {
	url := hosted(t)
	c, _ := New(Remote{URL: url, User: "me", Password: "not the password"})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, err := c.Sync(ctx, device(t))
	if err == nil {
		t.Fatal("a wrong password was accepted")
	}
}

func TestServerGuardsEverythingButHealth(t *testing.T) {
	url := hosted(t)
	for _, path := range []string{"/api/notes", "/api/trash", "/api/sync/attachments", "/attachments/0123456789abcdef.png", "/"} {
		res, err := http.Get(url + path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("GET %s without a password = %d, want 401", path, res.StatusCode)
		}
	}
	res, err := http.Get(url + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("health = %d, want 200 with no password", res.StatusCode)
	}
}

func TestForeignSiteCannotWrite(t *testing.T) {
	url := hosted(t)
	req, _ := http.NewRequest(http.MethodPost, url+"/api/notes", strings.NewReader(`{"title":"x","content":"y"}`))
	req.SetBasicAuth("me", testPass)
	req.Header.Set("Origin", "https://evil.example")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Errorf("a write claiming a foreign origin = %d, want 403", res.StatusCode)
	}
}

func TestPlainHTTPToARealHostIsRefused(t *testing.T) {
	if _, err := New(Remote{URL: "http://notes.example.com", User: "me", Password: "x"}); err == nil {
		t.Error("a password may not be sent over plain http to another machine")
	}
	if _, err := New(Remote{URL: "http://localhost:4321", User: "me", Password: "x"}); err != nil {
		t.Errorf("plain http to this machine should be allowed: %v", err)
	}
}

func TestSavedLoginIsPrivate(t *testing.T) {
	db := filepath.Join(t.TempDir(), "nib.db")
	if _, err := LoadRemote(db); err != ErrNoRemote {
		t.Fatalf("with nothing saved, got %v", err)
	}
	want := Remote{URL: "https://x.example", User: "me", Password: "pw"}
	if err := SaveRemote(db, want); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(ConfigPath(db))
	if info.Mode().Perm() != 0o600 {
		t.Errorf("login file mode = %v, want 0600", info.Mode().Perm())
	}
	got, err := LoadRemote(db)
	if err != nil || got != want {
		t.Errorf("loaded %+v, %v; want %+v", got, err, want)
	}
	if err := ForgetRemote(db); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadRemote(db); err != ErrNoRemote {
		t.Errorf("after logout, got %v", err)
	}
}
