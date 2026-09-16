package store

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// SnapshotsKept is how many startup copies of the database are retained.
const SnapshotsKept = 10

// Snapshot copies the database file into a backups/ directory beside it, then
// prunes the oldest copies. It runs before the database is opened, so the copy
// is of a quiescent file. A failure here must never stop the app starting.
//
// Attachments are deliberately left out. The database is mutable, so a copy of
// it from an hour ago is worth having; an attachment never changes, because it
// is named after a hash of its own contents. Copying them here would mean up
// to SnapshotsKept duplicates of every picture, rewritten on every launch, to
// protect bytes that cannot go stale. What attachments need is not to be lost,
// and the thirty-day trash in the attach package is what does that.
func Snapshot(dbPath string) (string, error) {
	info, err := os.Stat(dbPath)
	if err != nil {
		return "", nil // nothing to back up yet
	}
	if info.Size() == 0 {
		return "", nil
	}

	dir := filepath.Join(filepath.Dir(dbPath), "backups")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	// Named for the program. Snapshots written before the rename are called
	// notes-*.db; prune goes by extension, so those are still cleaned up.
	dest := filepath.Join(dir, fmt.Sprintf("nib-%s.db", time.Now().Format("20060102-150405")))
	if err := copyFile(dbPath, dest); err != nil {
		return "", err
	}
	if err := prune(dir); err != nil {
		return dest, err
	}
	return dest, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	tmp := dst + ".partial"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	// Rename last so a partial copy is never mistaken for a good snapshot.
	return os.Rename(tmp, dst)
}

func prune(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var snaps []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".db" {
			snaps = append(snaps, e.Name())
		}
	}
	if len(snaps) <= SnapshotsKept {
		return nil
	}
	sort.Strings(snaps) // timestamped names sort chronologically
	for _, name := range snaps[:len(snaps)-SnapshotsKept] {
		if err := os.Remove(filepath.Join(dir, name)); err != nil {
			return err
		}
	}
	return nil
}
