package attach

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// add stores a file and returns its name on disk.
func add(t *testing.T, s *Store, body string) string {
	t.Helper()
	ref, err := s.Add("f.txt", strings.NewReader(body))
	if err != nil {
		t.Fatalf("adding %q: %v", body, err)
	}
	return ref.Base()
}

func live(t *testing.T, s *Store, base string) bool {
	t.Helper()
	_, err := os.Stat(filepath.Join(s.Dir(), base))
	return err == nil
}

func trashed(t *testing.T, s *Store, base string) bool {
	t.Helper()
	_, err := os.Stat(filepath.Join(s.Dir(), ".trash", base))
	return err == nil
}

func refs(bases ...string) map[string]struct{} {
	m := make(map[string]struct{}, len(bases))
	for _, b := range bases {
		m[strings.TrimSuffix(b, filepath.Ext(b))] = struct{}{}
	}
	return m
}

func TestSweepTrashesWhatNoNoteUses(t *testing.T) {
	s := newTestStore(t)
	kept := add(t, s, "still referenced")
	dropped := add(t, s, "nothing points here")

	gone, back, err := s.Sweep(refs(kept))
	if err != nil {
		t.Fatal(err)
	}
	if gone != 1 || back != 0 {
		t.Errorf("Sweep = %d trashed, %d restored; want 1, 0", gone, back)
	}
	if !live(t, s, kept) {
		t.Errorf("%s was trashed although a note references it", kept)
	}
	if live(t, s, dropped) || !trashed(t, s, dropped) {
		t.Errorf("%s should have moved to the trash", dropped)
	}
}

func TestSweepBringsBackAFileThatIsUsedAgain(t *testing.T) {
	s := newTestStore(t)
	base := add(t, s, "undo me")

	if _, _, err := s.Sweep(refs()); err != nil {
		t.Fatal(err)
	}
	if !trashed(t, s, base) {
		t.Fatalf("%s did not reach the trash", base)
	}

	// The note is edited back, or restored from the note trash.
	gone, back, err := s.Sweep(refs(base))
	if err != nil {
		t.Fatal(err)
	}
	if gone != 0 || back != 1 {
		t.Errorf("Sweep = %d trashed, %d restored; want 0, 1", gone, back)
	}
	if !live(t, s, base) || trashed(t, s, base) {
		t.Errorf("%s was not brought back", base)
	}
}

func TestSweepIsIdempotent(t *testing.T) {
	s := newTestStore(t)
	base := add(t, s, "orphan")

	if _, _, err := s.Sweep(refs()); err != nil {
		t.Fatal(err)
	}
	gone, back, err := s.Sweep(refs())
	if err != nil {
		t.Fatal(err)
	}
	if gone != 0 || back != 0 {
		t.Errorf("second Sweep = %d, %d; want it to have nothing left to do", gone, back)
	}
	if !trashed(t, s, base) {
		t.Errorf("%s left the trash on a second sweep", base)
	}
}

func TestSweepIgnoresStrangers(t *testing.T) {
	s := newTestStore(t)
	// A file a person dropped in by hand, and our own working directories.
	stray := filepath.Join(s.Dir(), "notes-of-my-own.txt")
	if err := os.WriteFile(stray, []byte("mine"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, _, err := s.Sweep(refs()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stray); err != nil {
		t.Errorf("a file we did not write was moved: %v", err)
	}
	for _, sub := range []string{".trash", ".tmp"} {
		if _, err := os.Stat(filepath.Join(s.Dir(), sub)); err != nil {
			t.Errorf("%s was disturbed: %v", sub, err)
		}
	}
}

func TestSweepStampsTheTrashTime(t *testing.T) {
	s := newTestStore(t)
	base := add(t, s, "orphan")

	// Backdate the live file. Rename preserves the modification time, so
	// without an explicit stamp the file would look old the instant it is
	// trashed and PurgeExpired would delete it immediately.
	old := time.Now().Add(-365 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(s.Dir(), base), old, old); err != nil {
		t.Fatal(err)
	}

	before := time.Now()
	if _, _, err := s.Sweep(refs()); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(s.Dir(), ".trash", base))
	if err != nil {
		t.Fatal(err)
	}
	if info.ModTime().Before(before.Add(-time.Minute)) {
		t.Errorf("trashed at %v, want it stamped with roughly now (%v)", info.ModTime(), before)
	}
}

func TestPurgeExpiredDeletesOnlyWhatIsOldEnough(t *testing.T) {
	s := newTestStore(t)
	recent := add(t, s, "trashed a moment ago")
	ancient := add(t, s, "trashed long ago")

	if _, _, err := s.Sweep(refs()); err != nil {
		t.Fatal(err)
	}

	// Backdate one of them past the retention window.
	old := time.Now().Add(-40 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(s.Dir(), ".trash", ancient), old, old); err != nil {
		t.Fatal(err)
	}

	n, err := s.PurgeExpired(30 * 24 * time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("purged %d, want 1", n)
	}
	if !trashed(t, s, recent) {
		t.Errorf("%s was purged although it is recent", recent)
	}
	if trashed(t, s, ancient) {
		t.Errorf("%s survived although it is past the window", ancient)
	}
}

func TestPurgeExpiredLeavesLiveFilesAlone(t *testing.T) {
	s := newTestStore(t)
	base := add(t, s, "in use")

	old := time.Now().Add(-365 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(s.Dir(), base), old, old); err != nil {
		t.Fatal(err)
	}

	n, err := s.PurgeExpired(30 * 24 * time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("purged %d, want 0: PurgeExpired must only ever read the trash", n)
	}
	if !live(t, s, base) {
		t.Errorf("%s was deleted from the live directory", base)
	}
}

func TestPurgeExpiredOnAnEmptyTrash(t *testing.T) {
	s := newTestStore(t)
	n, err := s.PurgeExpired(30 * 24 * time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("purged %d from an empty trash, want 0", n)
	}
}

func TestSweepSurvivesConcurrentSweeps(t *testing.T) {
	// Two processes starting at once both sweep. They race on every rename;
	// whoever loses finds the file already gone, which is work done, not a
	// failure.
	s := newTestStore(t)
	for i := range 20 {
		add(t, s, fmt.Sprintf("file %d", i))
	}

	errs := make(chan error, 4)
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := s.Sweep(refs())
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("concurrent sweep: %v", err)
		}
	}
}
