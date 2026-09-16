package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAttachmentsLiveBesideTheDatabase(t *testing.T) {
	st := newTestStore(t)
	dir := st.Attachments().Dir()
	if !strings.HasSuffix(dir, "attachments") {
		t.Errorf("attachments at %q, want a directory of that name", dir)
	}
	if !strings.HasPrefix(dir, strings.TrimSuffix(st.Path, "notes.db")) {
		t.Errorf("attachments at %q, want them beside the database at %q", dir, st.Path)
	}
}

func TestSweepKeepsWhatALiveNoteUses(t *testing.T) {
	st := newTestStore(t)
	ref, err := st.Attachments().Add("shot.png", strings.NewReader("\x89PNG\r\n\x1a\npretend"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Create("With a picture", "here it is\n\n"+ref.Markdown()); err != nil {
		t.Fatal(err)
	}

	trashed, _, err := st.SweepAttachments()
	if err != nil {
		t.Fatal(err)
	}
	if trashed != 0 {
		t.Errorf("trashed %d files that a note is using", trashed)
	}
}

func TestSweepKeepsWhatATrashedNoteUses(t *testing.T) {
	// A note in the trash is recoverable for thirty days. Its pictures have to
	// last at least as long, or restoring it hands back a broken note.
	st := newTestStore(t)
	ref, err := st.Attachments().Add("shot.png", strings.NewReader("\x89PNG\r\n\x1a\npretend"))
	if err != nil {
		t.Fatal(err)
	}
	note, err := st.Create("Doomed", ref.Markdown())
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Delete(note.ID); err != nil {
		t.Fatal(err)
	}

	trashed, _, err := st.SweepAttachments()
	if err != nil {
		t.Fatal(err)
	}
	if trashed != 0 {
		t.Fatalf("trashed %d files belonging to a recoverable note", trashed)
	}

	if err := st.Restore(note.ID); err != nil {
		t.Fatal(err)
	}
	f, err := st.Attachments().Read(ref.Base())
	if err != nil {
		t.Errorf("the restored note's picture is gone: %v", err)
		return
	}
	f.Close()
}

func TestSweepTrashesWhatNothingUses(t *testing.T) {
	st := newTestStore(t)
	ref, err := st.Attachments().Add("orphan.txt", strings.NewReader("nobody wants me"))
	if err != nil {
		t.Fatal(err)
	}

	trashed, _, err := st.SweepAttachments()
	if err != nil {
		t.Fatal(err)
	}
	if trashed != 1 {
		t.Errorf("trashed %d, want the orphan gone", trashed)
	}
	// Still readable, because trashed is not deleted.
	f, err := st.Attachments().Read(ref.Base())
	if err != nil {
		t.Errorf("a trashed attachment should still be readable: %v", err)
		return
	}
	f.Close()
}

func TestSnapshotsAreNamedForTheProgram(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nib.db")
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Create("Something", "worth backing up"); err != nil {
		t.Fatal(err)
	}
	st.Close()

	dest, err := Snapshot(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := filepath.Base(dest); !strings.HasPrefix(got, "nib-") {
		t.Errorf("snapshot named %q, want it to start with nib-", got)
	}
}

func TestSnapshotsSkipAttachments(t *testing.T) {
	// An attachment is named after a hash of its own contents, so it can never
	// go stale and there is nothing to keep ten versions of.
	dir := t.TempDir()
	path := filepath.Join(dir, "nib.db")
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Attachments().Add("shot.png", strings.NewReader("\x89PNG\r\n\x1a\nx")); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Create("A note", "text"); err != nil {
		t.Fatal(err)
	}
	st.Close()

	if _, err := Snapshot(path); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(dir, "backups"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".db" {
			t.Errorf("backups holds %q, want only database copies", e.Name())
		}
	}
}
