package tui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/Prathmeshgumal/nib/internal/store"
)

// openEditor puts the model in the editor on the first note in the list.
func openEditor(t *testing.T, st *store.Store) model {
	t.Helper()
	m, _ := newTestModel(t)
	m.st = st
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	return press(m, key('\r'))
}

// contentOf reads a note straight from the store, which is the only place
// worth asserting on: the point of an autosave is that the file on disk has
// the writing in it.
func contentOf(t *testing.T, st *store.Store, id string) string {
	t.Helper()
	n, err := st.Get(id)
	if err != nil {
		t.Fatalf("reading note %s: %v", id, err)
	}
	return n.Content
}

func TestTypingSavesWithoutLeavingTheEditor(t *testing.T) {
	m, st := newTestModel(t)
	n, err := st.Create("Standup", "old")
	if err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})
	before := m.gen
	m = press(m, key('!'))
	if m.gen == before {
		t.Fatal("typing scheduled no write")
	}

	m = press(m, autosaveMsg{gen: m.gen})

	if got := contentOf(t, st, n.ID); got != "old!" {
		t.Errorf("stored content = %q, want %q", got, "old!")
	}
	if m.mode != modeEdit {
		t.Errorf("mode = %v, want modeEdit: an autosave must not close the editor", m.mode)
	}
}

func TestAStaleAutosaveWritesNothing(t *testing.T) {
	m, st := newTestModel(t)
	n, err := st.Create("Standup", "old")
	if err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})

	m = press(m, key('a'))
	stale := m.gen
	m = press(m, key('b')) // the write for 'a' is now out of date

	m = press(m, autosaveMsg{gen: stale})

	if got := contentOf(t, st, n.ID); got != "old" {
		t.Errorf("stored content = %q, want it untouched: a superseded write must not run", got)
	}
}

func TestTheLatestAutosaveWritesEverythingTypedSoFar(t *testing.T) {
	m, st := newTestModel(t)
	n, err := st.Create("Standup", "old")
	if err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})

	m = press(m, key('a'))
	m = press(m, key('b'))
	m = press(m, autosaveMsg{gen: m.gen})

	if got := contentOf(t, st, n.ID); got != "oldab" {
		t.Errorf("stored content = %q, want %q", got, "oldab")
	}
}

func TestEscapeKeepsWhatWasTyped(t *testing.T) {
	m, st := newTestModel(t)
	n, err := st.Create("Standup", "old")
	if err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})
	m = press(m, key('!'))
	m = press(m, autosaveMsg{gen: m.gen})

	m = press(m, tea.KeyMsg{Type: tea.KeyEsc})

	if got := contentOf(t, st, n.ID); got != "old!" {
		t.Errorf("stored content = %q, want %q: escape leaves the writing alone", got, "old!")
	}
	if m.mode != modeList {
		t.Errorf("mode = %v, want modeList", m.mode)
	}
}

// Escape is the reflex for "I am done here", so it has to be a way out that
// cannot cost anything - including in the second before the timer would have
// fired on its own.
func TestEscapeSavesWritingTheTimerHasNotReachedYet(t *testing.T) {
	m, st := newTestModel(t)
	n, err := st.Create("Standup", "old")
	if err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})
	m = press(m, key('!')) // no autosaveMsg: the pause never happened

	m = press(m, tea.KeyMsg{Type: tea.KeyEsc})

	if got := contentOf(t, st, n.ID); got != "old!" {
		t.Errorf("stored content = %q, want %q", got, "old!")
	}
}

func TestEscapeKeepsANewNote(t *testing.T) {
	m, st := newTestModel(t)
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, key('n'))
	m = press(m, key('h'))
	m = press(m, key('i'))

	m = press(m, tea.KeyMsg{Type: tea.KeyEsc})

	notes := mustList(t, st)
	if len(notes) != 1 || notes[0].Content != "hi" {
		t.Fatalf("live notes = %v, want the one note that was written", notes)
	}
	trash, err := st.Trash()
	if err != nil {
		t.Fatal(err)
	}
	if len(trash) != 0 {
		t.Errorf("trash holds %d notes, want 0: escape is not a delete", len(trash))
	}
}

func TestEscapeOnAnUntouchedNewNoteCreatesNothing(t *testing.T) {
	m, st := newTestModel(t)
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, key('n'))

	m = press(m, tea.KeyMsg{Type: tea.KeyEsc})

	if notes := mustList(t, st); len(notes) != 0 {
		t.Errorf("store holds %d notes, want 0", len(notes))
	}
}

func TestANewNoteIsCreatedOnceAndThenUpdated(t *testing.T) {
	m, st := newTestModel(t)
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, key('n'))

	m = press(m, key('h'))
	m = press(m, autosaveMsg{gen: m.gen})
	m = press(m, key('i'))
	m = press(m, autosaveMsg{gen: m.gen})

	notes := mustList(t, st)
	if len(notes) != 1 {
		t.Fatalf("store holds %d notes, want 1: the second autosave made a copy", len(notes))
	}
	if notes[0].Content != "hi" {
		t.Errorf("stored content = %q, want %q", notes[0].Content, "hi")
	}
}

func TestAnEmptyNewNoteIsNeverCreated(t *testing.T) {
	m, st := newTestModel(t)
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, key('n'))

	// Typed and then taken back out again, which is how a note ends up empty.
	m = press(m, key('x'))
	m = press(m, tea.KeyMsg{Type: tea.KeyBackspace})
	m = press(m, autosaveMsg{gen: m.gen})

	if notes := mustList(t, st); len(notes) != 0 {
		t.Errorf("store holds %d notes, want 0: an empty note is not a note", len(notes))
	}
}

func TestAnAutosaveLeavesTheListWhereItWas(t *testing.T) {
	m, st := newTestModel(t)
	for _, title := range []string{"oldest", "middle", "newest"} {
		if _, err := st.Create(title, title); err != nil {
			t.Fatal(err)
		}
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	// Edit the one at the bottom, the note an autosave would otherwise lift
	// to the top of a list ordered by most-recently-edited.
	m = press(m, tea.KeyMsg{Type: tea.KeyDown})
	m = press(m, tea.KeyMsg{Type: tea.KeyDown})
	before := append([]store.Note(nil), m.notes...)
	cursor := m.cursor

	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})
	m = press(m, key('!'))
	m = press(m, autosaveMsg{gen: m.gen})

	if m.cursor != cursor {
		t.Errorf("cursor moved from %d to %d while typing", cursor, m.cursor)
	}
	for i := range before {
		if m.notes[i].ID != before[i].ID {
			t.Fatalf("the list reordered under the cursor at row %d", i)
		}
	}
}

func TestControlSStillSavesAndCloses(t *testing.T) {
	m, st := newTestModel(t)
	n, err := st.Create("Standup", "old")
	if err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})
	m = press(m, key('!'))

	m = press(m, tea.KeyMsg{Type: tea.KeyCtrlS})

	if got := contentOf(t, st, n.ID); got != "old!" {
		t.Errorf("stored content = %q, want %q", got, "old!")
	}
	if m.mode != modeList {
		t.Errorf("mode = %v, want modeList: ctrl+s still closes the editor", m.mode)
	}
}

func TestAnAutosaveAfterLeavingTheEditorWritesNothing(t *testing.T) {
	m, st := newTestModel(t)
	n, err := st.Create("Standup", "old")
	if err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})
	m = press(m, key('!'))
	pending := m.gen
	m = press(m, tea.KeyMsg{Type: tea.KeyEsc}) // leaving flushes "old!"

	// Somebody else - the web UI on the same file, the next edit - moves the
	// note on. A timer left over from the closed editor must not undo that by
	// writing the draft it was holding.
	if _, err := st.Update(n.ID, "Standup", "written somewhere else"); err != nil {
		t.Fatal(err)
	}
	m = press(m, autosaveMsg{gen: pending})

	if got := contentOf(t, st, n.ID); got != "written somewhere else" {
		t.Errorf("stored content = %q, want %q: a timer wrote after the editor closed", got, "written somewhere else")
	}
}

func TestTheEditorSaysWhetherTheWritingIsSafe(t *testing.T) {
	m, st := newTestModel(t)
	if _, err := st.Create("Standup", "old"); err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})

	if got := m.helpLine(); !strings.Contains(got, "saved") {
		t.Errorf("on opening, the hint bar reads %q, want it to say the note is saved", got)
	}

	m = press(m, key('!'))
	if got := m.helpLine(); !strings.Contains(got, "unsaved") {
		t.Errorf("after typing, the hint bar reads %q, want it to say there is unsaved writing", got)
	}

	m = press(m, autosaveMsg{gen: m.gen})
	line := m.helpLine()
	if strings.Contains(line, "unsaved") || !strings.Contains(line, "saved") {
		t.Errorf("after an autosave, the hint bar reads %q, want it to say the note is saved", line)
	}
}

func TestQuittingMidEditKeepsTheWriting(t *testing.T) {
	m, st := newTestModel(t)
	n, err := st.Create("Standup", "old")
	if err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})
	m = press(m, key('!')) // typed, and the timer has not fired yet

	m = press(m, tea.KeyMsg{Type: tea.KeyCtrlC})

	if got := contentOf(t, st, n.ID); got != "old!" {
		t.Errorf("stored content = %q, want %q: quitting must not throw away the draft", got, "old!")
	}
}

func TestWritingComingBackFromAnExternalEditorIsSavedToo(t *testing.T) {
	m, st := newTestModel(t)
	n, err := st.Create("Standup", "old")
	if err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})

	// What ctrl+e hands back after $EDITOR has been and gone. Text arriving
	// this way has to schedule a write like any other edit, which the
	// generation going up is the record of - asserting only that a write
	// happens would pass even if nothing had been scheduled.
	before := m.gen
	m = press(m, editorDoneMsg("rewritten elsewhere"))
	if m.gen == before {
		t.Fatal("text from $EDITOR scheduled no write")
	}
	m = press(m, autosaveMsg{gen: m.gen})

	if got := contentOf(t, st, n.ID); got != "rewritten elsewhere" {
		t.Errorf("stored content = %q, want %q", got, "rewritten elsewhere")
	}
}
