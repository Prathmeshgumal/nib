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
