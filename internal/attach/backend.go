package attach

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// Backend is what the web server and the sync client need from wherever the
// files live. A directory on disk is one answer (*Store); the hosted server
// keeps them in Postgres instead, because a free host's disk does not survive
// a restart.
type Backend interface {
	// Add stores the bytes and returns a reference to them.
	Add(name string, r io.Reader) (Ref, error)
	// Open returns a stored file by its name, and when it was written.
	Open(base string) (io.ReadSeekCloser, time.Time, error)
	// List reports the names of every file held.
	List() ([]string, error)
	// Put stores bytes under exactly this name, refusing them if the name's
	// hash is not the hash of the bytes. Sync uses it to copy a file between
	// machines without the name changing on the way.
	Put(base string, r io.Reader) error
}

// Prepare reads a whole file into memory and works out its reference. It is
// for backends that hold files in a database, where there is no temporary file
// to stream into. MaxSize caps what is read.
func Prepare(name string, r io.Reader) (Ref, []byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, MaxSize+1))
	if err != nil {
		return Ref{}, nil, fmt.Errorf("reading the file: %w", err)
	}
	if len(data) > MaxSize {
		return Ref{}, nil, fmt.Errorf("%s is over %d bytes: %w", name, MaxSize, ErrTooLarge)
	}
	mimeType, ext := describe(data[:min(len(data), 512)], name)
	return Ref{
		ID:   HashID(data),
		Name: name,
		Ext:  ext,
		MIME: mimeType,
		Size: int64(len(data)),
	}, data, nil
}

// HashID is the id a file's contents are stored under.
func HashID(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])[:16]
}

// ValidBase reports whether base is a name this package could have written.
func ValidBase(base string) bool { return validBase(base) }

// IDOf is the hash part of a stored name.
func IDOf(base string) string { return idOf(base) }

// MIMEFor is the content type to serve a stored file as, judged from its bytes
// and the extension in its name.
func MIMEFor(head []byte, base string) string {
	m, _ := describe(head, base)
	return m
}

// Open implements Backend.
func (s *Store) Open(base string) (io.ReadSeekCloser, time.Time, error) {
	f, err := s.Read(base)
	if err != nil {
		return nil, time.Time{}, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, time.Time{}, err
	}
	return f, info.ModTime(), nil
}

// List implements Backend. Files in the trash are not listed: they are about
// to go, and a sync that copied them elsewhere would only carry the rubbish.
func (s *Store) List() ([]string, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() && validBase(e.Name()) {
			out = append(out, e.Name())
		}
	}
	return out, nil
}

// Put implements Backend.
func (s *Store) Put(base string, r io.Reader) error {
	if !validBase(base) {
		return fmt.Errorf("%q: %w", base, ErrBadName)
	}
	tmp, err := os.CreateTemp(filepath.Join(s.dir, tmpDir), "incoming-*")
	if err != nil {
		return fmt.Errorf("opening a temporary file: %w", err)
	}
	defer func() {
		tmp.Close()
		os.Remove(tmp.Name())
	}()

	sum := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, sum), io.LimitReader(r, MaxSize+1))
	if err != nil {
		return fmt.Errorf("reading the file: %w", err)
	}
	if size > MaxSize {
		return fmt.Errorf("%s: %w", base, ErrTooLarge)
	}
	if got := hex.EncodeToString(sum.Sum(nil))[:16]; got != idOf(base) {
		return fmt.Errorf("%s: contents hash to %s: %w", base, got, ErrBadName)
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	final := filepath.Join(s.dir, base)
	if _, err := os.Stat(final); err == nil {
		return nil
	}
	return os.Rename(tmp.Name(), final)
}

var _ Backend = (*Store)(nil)
