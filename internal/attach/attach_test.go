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
