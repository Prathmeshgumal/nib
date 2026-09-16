// Package attach stores the files a note refers to. It owns one directory on
// disk and nothing else: it never opens a database and never reaches the
// network, so a caller can point it at a temporary directory and test it whole.
package attach

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
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

	// Read one byte past the cap, so hitting the limit is distinguishable
	// from ending exactly on it.
	size, err := io.Copy(dst, io.LimitReader(r, MaxSize+1))
	if err != nil {
		return Ref{}, fmt.Errorf("reading the file: %w", err)
	}
	if size > MaxSize {
		return Ref{}, fmt.Errorf("%s is %d bytes: %w", name, size, ErrTooLarge)
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

// name is the exact shape this package writes: sixteen lowercase hex
// characters, a dot, and a short lowercase extension. Anything else is
// refused before it is used to build a path, so no request can name a file
// outside the directory however it is spelled or encoded.
var storedName = regexp.MustCompile(`^[0-9a-f]{16}\.[a-z0-9]{1,8}$`)

func validBase(base string) bool { return storedName.MatchString(base) }

// Read opens a stored attachment by its name on disk.
//
// A file in the trash is still served. A caller naming a file by the hash of
// its contents is holding a reference to it, and a sweep in another process
// may have moved it a moment ago; refusing would turn that race into a broken
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
