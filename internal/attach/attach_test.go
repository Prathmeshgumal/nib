package attach

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
	if gone, _, err := s.Sweep(toSet(Refs("# Holiday\n"))); err != nil || gone != 1 {
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
	if _, _, err := s.Sweep(toSet(Refs("# Holiday\n"))); err != nil {
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

// toSet is the shape Sweep wants, built from what Refs returns. This is the
// join every caller of Sweep will have to make.
func toSet(ids []string) map[string]struct{} {
	m := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		m[id] = struct{}{}
	}
	return m
}
