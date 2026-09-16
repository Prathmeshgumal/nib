package attach

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// errRaced means another process moved the file first. It never reaches a
// caller: it only tells the loop to skip that file and not count it.
var errRaced = errors.New("already moved")

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
			// Another process swept at the same moment and won the race. Its
			// work is ours, so there is nothing to do and nothing wrong.
			if errors.Is(err, os.ErrNotExist) {
				return errRaced
			}
			return fmt.Errorf("moving %s: %w", base, err)
		}
		// Rename keeps the original modification time, and PurgeExpired reads
		// it to decide what is old. Stamp it so the clock starts now.
		now := time.Now()
		if err := os.Chtimes(dst, now, now); err != nil && !errors.Is(err, os.ErrNotExist) {
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
			if errors.Is(err, errRaced) {
				continue
			}
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
			if errors.Is(err, errRaced) {
				continue
			}
			return trashed, restored, err
		}
		restored++
	}
	return trashed, restored, nil
}

// idOf is the id part of a name on disk. Only ever called on names validBase
// has already accepted.
func idOf(base string) string { return strings.TrimSuffix(base, filepath.Ext(base)) }

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
