package attach

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
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
