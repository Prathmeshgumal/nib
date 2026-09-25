package tui

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/Prathmeshgumal/nib/internal/store"
)

func newTestModel(t *testing.T) (model, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("opening store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return New(st), st
}

// key builds the message Bubble Tea delivers for a single character.
func key(r rune) tea.KeyMsg {
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}}
}

func press(m model, msg tea.Msg) model {
	next, _ := m.Update(msg)
	return next.(model)
}

func TestListModeKeysSwitchMode(t *testing.T) {
	m, st := newTestModel(t)
	if _, err := st.Create("First", "one"); err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})

	for _, tc := range []struct {
		name string
		key  rune
		want mode
	}{
		{"new note", 'n', modeEdit},
		{"help", '?', modeHelp},
		{"search", '/', modeSearch},
		{"delete confirm", 'd', modeConfirm},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := press(m, key(tc.key))
			if got.mode != tc.want {
				t.Errorf("pressing %q: mode = %v, want %v", tc.key, got.mode, tc.want)
			}
		})
	}
}

func TestCreateNoteFlow(t *testing.T) {
	m, st := newTestModel(t)
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})

	m = press(m, key('n'))
	if m.mode != modeEdit {
		t.Fatalf("expected edit mode, got %v", m.mode)
	}
	for _, r := range "hello world" {
		m = press(m, key(r))
	}
	if got := m.body.Value(); got != "hello world" {
		t.Fatalf("body = %q, want %q", got, "hello world")
	}

	m = press(m, tea.KeyMsg{Type: tea.KeyCtrlS})
	if m.mode != modeList {
		t.Errorf("after save, mode = %v, want list", m.mode)
	}

	notes := mustList(t, st)
	if len(notes) != 1 {
		t.Fatalf("expected 1 note saved, got %d", len(notes))
	}
	if notes[0].Content != "hello world" {
		t.Errorf("content = %q", notes[0].Content)
	}
	if notes[0].Title != "hello world" {
		t.Errorf("title should fall back to the first line, got %q", notes[0].Title)
	}
}

// Escape closes the editor. It used to discard the writing with it; now that
// a note saves itself, keeping the writing is the whole point - see
// TestEscapeKeepsWhatWasTyped and the rest in autosave_test.go.
func TestEscapeClosesTheEditor(t *testing.T) {
	m, st := newTestModel(t)
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, key('n'))
	m = press(m, key('x'))
	m = press(m, tea.KeyMsg{Type: tea.KeyEsc})

	if m.mode != modeList {
		t.Errorf("mode = %v, want list", m.mode)
	}
	if notes := mustList(t, st); len(notes) != 1 {
		t.Errorf("escape kept %d notes, want the one that was written", len(notes))
	}
}

func TestDeleteConfirmation(t *testing.T) {
	m, st := newTestModel(t)
	if _, err := st.Create("Doomed", "x"); err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})

	// "n" at the confirmation prompt must cancel, not delete.
	cancelled := press(press(m, key('d')), key('n'))
	if cancelled.mode != modeList {
		t.Errorf("cancel: mode = %v, want list", cancelled.mode)
	}
	if len(mustList(t, st)) != 1 {
		t.Fatal("note was deleted despite cancelling")
	}

	confirmed := press(press(m, key('d')), key('y'))
	if confirmed.mode != modeList {
		t.Errorf("confirm: mode = %v, want list", confirmed.mode)
	}
	if n := len(mustList(t, st)); n != 0 {
		t.Errorf("note should be gone, %d remain", n)
	}
}

func TestNavigationClampsToBounds(t *testing.T) {
	m, st := newTestModel(t)
	for _, title := range []string{"a", "b", "c"} {
		if _, err := st.Create(title, title); err != nil {
			t.Fatal(err)
		}
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})

	up := press(m, key('w')) // already at the top
	if up.cursor != 0 {
		t.Errorf("cursor went above the first note: %d", up.cursor)
	}
	down := m
	for i := 0; i < 10; i++ {
		down = press(down, key('s'))
	}
	if down.cursor != 2 {
		t.Errorf("cursor = %d, want it clamped to 2", down.cursor)
	}
}

func TestViewRendersWithoutWindowSize(t *testing.T) {
	m, _ := newTestModel(t)
	if out := m.View(); out == "" {
		t.Error("View() returned nothing before any WindowSizeMsg")
	}
}

func mustList(t *testing.T, st *store.Store) []store.Note {
	t.Helper()
	notes, err := st.List("")
	if err != nil {
		t.Fatalf("listing notes: %v", err)
	}
	return notes
}

func TestUndoRestoresLastDelete(t *testing.T) {
	m, st := newTestModel(t)
	n, err := st.Create("Precious", "body")
	if err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})

	m = press(press(m, key('d')), key('y'))
	if len(mustList(t, st)) != 0 {
		t.Fatal("note was not trashed")
	}

	m = press(m, key('u'))
	notes := mustList(t, st)
	if len(notes) != 1 || notes[0].ID != n.ID {
		t.Fatalf("undo did not restore the note: %v", notes)
	}
}

func TestUndoWithNothingDeletedIsHarmless(t *testing.T) {
	m, st := newTestModel(t)
	if _, err := st.Create("a", "b"); err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})

	m = press(m, key('u'))
	if m.err != nil {
		t.Errorf("undo with nothing to undo set an error: %v", m.err)
	}
	if len(mustList(t, st)) != 1 {
		t.Error("undo changed the notes")
	}
}

func TestListIsMostRecentlyEditedFirst(t *testing.T) {
	m, st := newTestModel(t)
	first, _ := st.Create("oldest", "a")
	if _, err := st.Create("newest", "b"); err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	if m.notes[0].Title != "newest" {
		t.Fatalf("order = %v, want the newest note first", titlesOf(m.notes))
	}

	// Touching the older note must float it to the top.
	if _, err := st.Update(first.ID, "oldest", "edited"); err != nil {
		t.Fatal(err)
	}
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	if m.notes[0].Title != "oldest" {
		t.Errorf("order = %v, want the just-edited note first", titlesOf(m.notes))
	}
}

// Saving reorders the list; the cursor must follow the note, not the index.
func TestSelectionFollowsNoteAcrossReorder(t *testing.T) {
	m, st := newTestModel(t)
	if _, err := st.Create("one", "a"); err != nil {
		t.Fatal(err)
	}
	older, _ := st.Create("two", "b")
	if _, err := st.Create("three", "c"); err != nil {
		t.Fatal(err)
	}

	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})

	// Select the oldest note, which sits last.
	for m.selected() != nil && m.selected().ID != older.ID {
		m = press(m, key('s'))
	}
	if m.selected() == nil || m.selected().ID != older.ID {
		t.Fatal("could not select the target note")
	}

	// Edit and save it: it jumps to the top of the list.
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})
	m = press(m, key('!'))
	m = press(m, tea.KeyMsg{Type: tea.KeyCtrlS})
	m = press(m, reloadedMsg{notes: mustList(t, st)})

	if got := m.selected(); got == nil || got.ID != older.ID {
		t.Errorf("selection landed on %v, want the note that was just saved", got)
	}
}

func titlesOf(notes []store.Note) []string {
	out := make([]string, len(notes))
	for i, n := range notes {
		out[i] = n.Title
	}
	return out
}
func TestCtrlBBoldsTheWordUnderTheCursor(t *testing.T) {
	m, _ := newTestModel(t)
	m = press(m, tea.WindowSizeMsg{Width: 90, Height: 30})
	m = press(m, key('n'))
	for _, r := range "hello" {
		m = press(m, key(r))
	}
	m = press(m, tea.KeyMsg{Type: tea.KeyCtrlB})

	if got := m.body.Value(); got != "**hello**" {
		t.Errorf("body = %q, want %q", got, "**hello**")
	}
}

func TestAltIItalicsTheWord(t *testing.T) {
	m, _ := newTestModel(t)
	m = press(m, tea.WindowSizeMsg{Width: 90, Height: 30})
	m = press(m, key('n'))
	for _, r := range "hello" {
		m = press(m, key(r))
	}
	m = press(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'i'}, Alt: true})

	if got := m.body.Value(); got != "*hello*" {
		t.Errorf("body = %q, want %q", got, "*hello*")
	}
}

func TestCtrlKMakesALink(t *testing.T) {
	m, _ := newTestModel(t)
	m = press(m, tea.WindowSizeMsg{Width: 90, Height: 30})
	m = press(m, key('n'))
	for _, r := range "docs" {
		m = press(m, key(r))
	}
	m = press(m, tea.KeyMsg{Type: tea.KeyCtrlK})

	if got := m.body.Value(); got != "[docs]()" {
		t.Errorf("body = %q, want %q", got, "[docs]()")
	}
	// Typing continues inside the parentheses.
	for _, r := range "https://x.test" {
		m = press(m, key(r))
	}
	if got := m.body.Value(); got != "[docs](https://x.test)" {
		t.Errorf("typing after ctrl+k gave %q", got)
	}
}

// The title field is a single line; formatting keys there would be noise.
func TestFormattingKeysAreIgnoredInTheTitle(t *testing.T) {
	m, _ := newTestModel(t)
	m = press(m, tea.WindowSizeMsg{Width: 90, Height: 30})
	m = press(m, key('n'))
	m = press(m, tea.KeyMsg{Type: tea.KeyTab}) // focus the title
	for _, r := range "plain" {
		m = press(m, key(r))
	}
	m = press(m, tea.KeyMsg{Type: tea.KeyCtrlB})

	if got := m.title.Value(); got != "plain" {
		t.Errorf("title = %q, want it untouched", got)
	}
}
func stripANSI(s string) string {
	var b strings.Builder
	esc := false
	for _, r := range s {
		if r == 0x1b {
			esc = true
			continue
		}
		if esc {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
				esc = false
			}
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// Deleting several notes must be undoable several times, not just once.
func TestUndoWalksBackThroughDeletes(t *testing.T) {
	m, st := newTestModel(t)
	for _, title := range []string{"one", "two", "three"} {
		if _, err := st.Create(title, title); err != nil {
			t.Fatal(err)
		}
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})

	for i := 0; i < 3; i++ {
		m = press(press(m, key('d')), key('y'))
		m = press(m, reloadedMsg{notes: mustList(t, st)})
	}
	if n := len(mustList(t, st)); n != 0 {
		t.Fatalf("expected everything trashed, %d left", n)
	}

	for i := 1; i <= 3; i++ {
		m = press(m, key('u'))
		m = press(m, reloadedMsg{notes: mustList(t, st)})
		if got := len(mustList(t, st)); got != i {
			t.Fatalf("after %d undos, %d notes are back, want %d", i, got, i)
		}
	}

	// A fourth undo has nothing left to do and must not error.
	m = press(m, key('u'))
	if m.err != nil {
		t.Errorf("undo past the end set an error: %v", m.err)
	}
}

func TestTrashViewListsAndRestores(t *testing.T) {
	m, st := newTestModel(t)
	keep, _ := st.Create("keep", "a")
	gone, _ := st.Create("gone", "b")
	if err := st.Delete(gone.ID); err != nil {
		t.Fatal(err)
	}

	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})

	m = press(m, key('T'))
	if m.mode != modeTrash {
		t.Fatalf("T should open the trash, mode = %v", m.mode)
	}
	trash, err := st.Trash()
	if err != nil {
		t.Fatal(err)
	}
	m = press(m, trashLoadedMsg{notes: trash})
	if len(m.trash) != 1 || m.trash[0].ID != gone.ID {
		t.Fatalf("trash holds %v, want the deleted note", titlesOf(m.trash))
	}

	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})
	back := mustList(t, st)
	if len(back) != 2 {
		t.Fatalf("after restoring, %d notes are live, want 2", len(back))
	}
	_ = keep

	m = press(m, tea.KeyMsg{Type: tea.KeyEsc})
	if m.mode != modeList {
		t.Errorf("esc should leave the trash, mode = %v", m.mode)
	}
}

// Restoring from the trash must not leave a stale id for undo to trip over.
func TestUndoAfterRestoringFromTrashIsHarmless(t *testing.T) {
	m, st := newTestModel(t)
	n, _ := st.Create("note", "x")
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})

	m = press(press(m, key('d')), key('y'))  // trashed, id pushed for undo
	if err := st.Restore(n.ID); err != nil { // restored another way
		t.Fatal(err)
	}

	m = press(m, key('u'))
	if m.err != nil {
		t.Errorf("undo of an already-restored note errored: %v", m.err)
	}
	if got := len(mustList(t, st)); got != 1 {
		t.Errorf("%d notes live, want 1", got)
	}
}

func TestPurgeFromTrashNeedsConfirmation(t *testing.T) {
	m, st := newTestModel(t)
	n, _ := st.Create("doomed", "x")
	if err := st.Delete(n.ID); err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, key('T'))
	trash, _ := st.Trash()
	m = press(m, trashLoadedMsg{notes: trash})

	// Answering no must leave it recoverable.
	cancelled := press(press(m, key('d')), key('n'))
	if cancelled.mode != modeTrash {
		t.Errorf("cancelling should return to the trash, mode = %v", cancelled.mode)
	}
	if tr, _ := st.Trash(); len(tr) != 1 {
		t.Fatal("the note was purged despite cancelling")
	}

	confirmed := press(press(m, key('d')), key('y'))
	if confirmed.mode != modeTrash {
		t.Errorf("confirming should return to the trash, mode = %v", confirmed.mode)
	}
	if tr, _ := st.Trash(); len(tr) != 0 {
		t.Errorf("the note was not purged, %d left in the trash", len(tr))
	}
	// Gone for good.
	if err := st.Restore(n.ID); err == nil {
		t.Error("a purged note could still be restored")
	}
}

func TestEmptyTrashNeedsConfirmationAndSparesLiveNotes(t *testing.T) {
	m, st := newTestModel(t)
	if _, err := st.Create("keep me", "a"); err != nil {
		t.Fatal(err)
	}
	for _, title := range []string{"x", "y"} {
		n, _ := st.Create(title, title)
		if err := st.Delete(n.ID); err != nil {
			t.Fatal(err)
		}
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, key('T'))
	trash, _ := st.Trash()
	m = press(m, trashLoadedMsg{notes: trash})

	cancelled := press(press(m, key('E')), key('n'))
	if tr, _ := st.Trash(); len(tr) != 2 {
		t.Fatal("the trash was emptied despite cancelling")
	}
	_ = cancelled

	m = press(press(m, key('E')), key('y'))
	if tr, _ := st.Trash(); len(tr) != 0 {
		t.Errorf("trash still holds %d notes", len(tr))
	}
	live := mustList(t, st)
	if len(live) != 1 || live[0].Title != "keep me" {
		t.Errorf("live notes = %v, want only the kept one", titlesOf(live))
	}
	// Undo must not try to restore ids that no longer exist.
	m = press(m, tea.KeyMsg{Type: tea.KeyEsc})
	m = press(m, key('u'))
	if m.err != nil {
		t.Errorf("undo after emptying the trash errored: %v", m.err)
	}
}

// The question must name what it is about, so nothing is confirmed blind.
func TestConfirmPromptsNameTheirTarget(t *testing.T) {
	m, st := newTestModel(t)
	n, _ := st.Create("Quarterly plan", "x")
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})

	asked := press(m, key('d'))
	if !strings.Contains(asked.confirmPrompt, "Quarterly plan") {
		t.Errorf("prompt %q does not name the note", asked.confirmPrompt)
	}
	if !strings.Contains(asked.View(), "Quarterly plan") {
		t.Error("the question is not visible on screen")
	}

	if err := st.Delete(n.ID); err != nil {
		t.Fatal(err)
	}
	inTrash := press(m, key('T'))
	trash, _ := st.Trash()
	inTrash = press(inTrash, trashLoadedMsg{notes: trash})
	purge := press(inTrash, key('d'))
	if !strings.Contains(purge.confirmPrompt, "cannot be undone") {
		t.Errorf("a permanent delete should say so: %q", purge.confirmPrompt)
	}
}

// Every formatting key must reach its action through the update loop, not just
// work as a function.
func TestFormattingKeysAreWired(t *testing.T) {
	for _, tc := range []struct {
		keys  []tea.KeyMsg
		typed string
		want  string
	}{
		{[]tea.KeyMsg{{Type: tea.KeyCtrlB}}, "word", "**word**"},
		{[]tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'i'}, Alt: true}}, "word", "*word*"},
		{[]tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'s'}, Alt: true}}, "word", "~~word~~"},
		{[]tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'c'}, Alt: true}}, "word", "`word`"},
		{[]tea.KeyMsg{{Type: tea.KeyCtrlK}}, "word", "[word]()"},
		{[]tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'h'}, Alt: true}}, "line", "# line"},
		{[]tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'q'}, Alt: true}}, "line", "> line"},
		{[]tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'l'}, Alt: true}}, "line", "- line"},
		{[]tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'o'}, Alt: true}}, "line", "1. line"},
		// The digits remain as aliases where a terminal passes them through.
		{[]tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'8'}, Alt: true}}, "line", "- line"},
		{[]tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'7'}, Alt: true}}, "line", "1. line"},
		{[]tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'t'}, Alt: true}}, "line", "- [ ] line"},
		{[]tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'f'}, Alt: true}}, "code", "```\ncode\n```"},
	} {
		m, _ := newTestModel(t)
		m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
		m = press(m, key('n'))
		for _, r := range tc.typed {
			m = press(m, key(r))
		}
		for _, k := range tc.keys {
			m = press(m, k)
		}
		if got := m.body.Value(); got != tc.want {
			t.Errorf("%v on %q gave %q, want %q", tc.keys[0], tc.typed, got, tc.want)
		}
	}
}

func TestAltXTicksTheTaskUnderTheCursor(t *testing.T) {
	m, _ := newTestModel(t)
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, key('n'))
	for _, r := range "feed the cat" {
		m = press(m, key(r))
	}
	m = press(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'t'}, Alt: true})
	if got := m.body.Value(); got != "- [ ] feed the cat" {
		t.Fatalf("alt+t gave %q", got)
	}
	m = press(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}, Alt: true})
	if got := m.body.Value(); got != "- [x] feed the cat" {
		t.Errorf("alt+x gave %q", got)
	}
}

// ctrl+p previews the draft, which must show unsaved text, not the saved note.
func TestPreviewShowsUnsavedText(t *testing.T) {
	m, st := newTestModel(t)
	n, err := st.Create("Note", "saved content")
	if err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})
	_ = n

	for _, r := range " plus unsaved" {
		m = press(m, key(r))
	}
	m = press(m, tea.KeyMsg{Type: tea.KeyCtrlP})
	if !m.previewDraft {
		t.Fatal("ctrl+p did not turn the preview on")
	}
	view := stripANSI(m.View())
	if !strings.Contains(view, "unsaved") {
		t.Errorf("the preview does not show the unsaved text:\n%s", view)
	}

	m = press(m, tea.KeyMsg{Type: tea.KeyCtrlP})
	if m.previewDraft {
		t.Error("ctrl+p did not turn the preview back off")
	}
}

// Formatting must not fire while the single-line title has focus.
func TestFormattingIsIgnoredInTheTitleField(t *testing.T) {
	m, _ := newTestModel(t)
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, key('n'))
	m = press(m, tea.KeyMsg{Type: tea.KeyTab})
	for _, r := range "title" {
		m = press(m, key(r))
	}
	for _, k := range []tea.KeyMsg{
		{Type: tea.KeyCtrlB},
		{Type: tea.KeyRunes, Runes: []rune{'l'}, Alt: true},
		{Type: tea.KeyRunes, Runes: []rune{'h'}, Alt: true},
	} {
		m = press(m, k)
	}
	if got := m.title.Value(); got != "title" {
		t.Errorf("title = %q, want it untouched", got)
	}
	if got := m.body.Value(); got != "" {
		t.Errorf("body = %q, want it untouched", got)
	}
}

// The editor's defaults cap a textarea at 99 lines and refuse Enter beyond it,
// while pasted text ignores the cap — so a long note would silently stop
// accepting new lines. Notes are not limited.
func TestLongNotesStillAcceptNewLines(t *testing.T) {
	m, st := newTestModel(t)
	long := strings.Repeat("a line of a pasted markdown file\n", 400)
	if _, err := st.Create("Pasted", long); err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter}) // open the editor

	before := strings.Count(m.body.Value(), "\n")
	if before < 99 {
		t.Fatalf("the test note is only %d lines; it must exceed the old cap", before)
	}

	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})
	if got := strings.Count(m.body.Value(), "\n"); got != before+1 {
		t.Errorf("Enter did nothing on a %d-line note (still %d lines)", before, got)
	}

	for _, r := range "typed after the newline" {
		m = press(m, key(r))
	}
	if !strings.Contains(m.body.Value(), "typed after the newline") {
		t.Error("typing after the new line did not reach the note")
	}
}

func TestEditorHasNoLineOrWidthCap(t *testing.T) {
	m, _ := newTestModel(t)
	if m.body.MaxHeight != 0 {
		t.Errorf("MaxHeight = %d, want 0 (unlimited)", m.body.MaxHeight)
	}
	if m.body.MaxWidth != 0 {
		t.Errorf("MaxWidth = %d, want 0 (unlimited)", m.body.MaxWidth)
	}
}

// Formatting a word far down a long note must not scroll the editor back to
// the top. Rewriting the whole note with SetValue did exactly that.
func TestFormattingKeepsTheEditorWhereItIs(t *testing.T) {
	m, st := newTestModel(t)
	body := strings.Repeat("a line of an existing note\n", 120) + "target word here"
	if _, err := st.Create("Long", body); err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 24})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})

	// Opening an existing note leaves the caret at the end, on the last line.
	rowBefore := m.body.Line()
	if rowBefore < 100 {
		t.Fatalf("expected the caret near the end, it is on row %d", rowBefore)
	}
	viewBefore := stripANSI(m.body.View())
	if !strings.Contains(viewBefore, "target word here") {
		t.Fatalf("the last line is not on screen to begin with:\n%s", viewBefore)
	}

	m = press(m, tea.KeyMsg{Type: tea.KeyCtrlB})

	if !strings.Contains(m.body.Value(), "**here**") {
		t.Errorf("ctrl+b did not bold the word: %q", lastLine(m.body.Value()))
	}
	if got := m.body.Line(); got != rowBefore {
		t.Errorf("the caret jumped from row %d to row %d", rowBefore, got)
	}
	if view := stripANSI(m.body.View()); !strings.Contains(view, "**here**") {
		t.Errorf("the editor scrolled away from the edit:\n%s", view)
	}
}

// The same for a line-based action.
func TestLineFormattingKeepsTheEditorWhereItIs(t *testing.T) {
	m, st := newTestModel(t)
	body := strings.Repeat("filler line\n", 120) + "make me a heading"
	if _, err := st.Create("Long", body); err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 24})
	m = press(m, reloadedMsg{notes: mustList(t, st)})
	m = press(m, tea.KeyMsg{Type: tea.KeyEnter})

	rowBefore := m.body.Line()
	m = press(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'h'}, Alt: true})

	if !strings.HasSuffix(m.body.Value(), "# make me a heading") {
		t.Errorf("alt+h did not add the heading: %q", lastLine(m.body.Value()))
	}
	if got := m.body.Line(); got != rowBefore {
		t.Errorf("the caret jumped from row %d to row %d", rowBefore, got)
	}
	if view := stripANSI(m.body.View()); !strings.Contains(view, "# make me a heading") {
		t.Errorf("the editor scrolled away from the edit:\n%s", view)
	}
}

func lastLine(s string) string {
	parts := strings.Split(strings.TrimRight(s, "\n"), "\n")
	return parts[len(parts)-1]
}

// w/s move between notes and j/k scroll the one being read, whatever the
// mouse has been doing. The arrows and the wheel are the context-sensitive
// pair — see TestArrowsFollowTheFocus.
func TestNoteKeysMoveAndScroll(t *testing.T) {
	m, st := newTestModel(t)
	for _, title := range []string{"a", "b", "c"} {
		if _, err := st.Create(title, title); err != nil {
			t.Fatal(err)
		}
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})

	for _, tc := range []struct {
		msg  tea.Msg
		want int
		why  string
	}{
		{key('s'), 1, "s moves to the next note"},
		{key('s'), 2, "s again"},
		{key('w'), 1, "w moves back"},
		{key('j'), 1, "j scrolls, it does not move"},
		{key('k'), 1, "k scrolls, it does not move"},
	} {
		m = press(m, tc.msg)
		if m.cursor != tc.want {
			t.Errorf("%s: cursor = %d, want %d", tc.why, m.cursor, tc.want)
		}
	}
}

// w now means "previous note", so the web UI moved to W. A lowercase w must
// never start a server.
func TestLowercaseWDoesNotStartTheWebUI(t *testing.T) {
	m, st := newTestModel(t)
	if _, err := st.Create("a", "a"); err != nil {
		t.Fatal(err)
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	m = press(m, reloadedMsg{notes: mustList(t, st)})

	next, cmd := m.Update(key('w'))
	if cmd != nil {
		t.Error("w returned a command; it should only move the cursor")
	}
	if next.(model).server != nil {
		t.Error("w started the web server")
	}
}

// click builds the message Bubble Tea delivers for a left-button press.
func click(x, y int) tea.MouseMsg {
	return tea.MouseMsg{X: x, Y: y, Action: tea.MouseActionPress, Button: tea.MouseButtonLeft}
}

func wheel(up bool) tea.MouseMsg {
	b := tea.MouseButtonWheelDown
	if up {
		b = tea.MouseButtonWheelUp
	}
	return tea.MouseMsg{Action: tea.MouseActionPress, Button: b}
}

func longNotesModel(t *testing.T, titles ...string) model {
	t.Helper()
	m, st := newTestModel(t)
	for _, title := range titles {
		if _, err := st.Create(title, strings.Repeat(title+"\n", 200)); err != nil {
			t.Fatal(err)
		}
	}
	m = press(m, tea.WindowSizeMsg{Width: 100, Height: 30})
	return press(m, reloadedMsg{notes: mustList(t, st)})
}

// Clicking a pane aims the arrows and the wheel at it.
func TestClickFocusesAPane(t *testing.T) {
	m := longNotesModel(t, "one", "two", "three")
	g := m.geometry()

	// The note being read starts focused, so the wheel scrolls it.
	if m.focus != paneDoc {
		t.Fatalf("focus starts at %v, want the document", m.focus)
	}
	m = press(m, wheel(false))
	if m.preview.YOffset != 1 {
		t.Errorf("wheel over the document scrolled %d lines, want 1", m.preview.YOffset)
	}
	if m.cursor != 0 {
		t.Errorf("wheel over the document changed the note to %d", m.cursor)
	}

	// Click the list, and the same wheel turn moves between notes instead.
	m = press(m, click(g.asideX+2, g.listY))
	if m.focus != paneList {
		t.Fatal("clicking the list did not focus it")
	}
	before := m.preview.YOffset
	m = press(m, wheel(false))
	if m.cursor != 1 {
		t.Errorf("wheel over the list moved to %d, want 1", m.cursor)
	}
	m = press(m, wheel(true))
	if m.cursor != 0 {
		t.Errorf("wheel back moved to %d, want 0", m.cursor)
	}
	_ = before

	// Click back on the note, and it scrolls again.
	m = press(m, click(1, 3))
	if m.focus != paneDoc {
		t.Fatal("clicking the note did not focus it")
	}
	at := m.preview.YOffset
	m = press(m, wheel(false))
	if m.preview.YOffset != at+1 {
		t.Errorf("wheel over the document scrolled to %d, want %d", m.preview.YOffset, at+1)
	}
}

// The arrows follow the focus, exactly as the wheel does.
func TestArrowsFollowTheFocus(t *testing.T) {
	m := longNotesModel(t, "one", "two", "three")
	g := m.geometry()

	m = press(m, tea.KeyMsg{Type: tea.KeyDown})
	if m.preview.YOffset != 1 || m.cursor != 0 {
		t.Errorf("with the document focused, down gave offset %d cursor %d, want 1 and 0",
			m.preview.YOffset, m.cursor)
	}

	m = press(m, click(g.asideX+2, g.listY))
	m = press(m, tea.KeyMsg{Type: tea.KeyDown})
	if m.cursor != 1 {
		t.Errorf("with the list focused, down gave cursor %d, want 1", m.cursor)
	}
}

// Whatever the mouse has been doing, these four keys mean one thing each.
func TestWSAndJKIgnoreTheFocus(t *testing.T) {
	for _, where := range []string{"document", "list"} {
		m := longNotesModel(t, "one", "two", "three")
		g := m.geometry()
		if where == "list" {
			m = press(m, click(g.asideX+2, g.listY))
		} else {
			m = press(m, click(1, 3))
		}

		m = press(m, key('s'))
		if m.cursor != 1 {
			t.Errorf("focus on the %s: s gave cursor %d, want 1", where, m.cursor)
		}
		m = press(m, key('w'))
		if m.cursor != 0 {
			t.Errorf("focus on the %s: w gave cursor %d, want 0", where, m.cursor)
		}

		m = press(m, key('j'))
		if m.preview.YOffset != 1 {
			t.Errorf("focus on the %s: j scrolled %d, want 1", where, m.preview.YOffset)
		}
		if m.cursor != 0 {
			t.Errorf("focus on the %s: j changed the note to %d", where, m.cursor)
		}
	}
}

// Clicking a title opens that note.
func TestClickingATitleSelectsIt(t *testing.T) {
	m := longNotesModel(t, "one", "two", "three")
	g := m.geometry()

	m = press(m, click(g.asideX+3, g.itemsY+2))
	if m.cursor != 2 {
		t.Errorf("clicking the third title selected %d, want 2", m.cursor)
	}
	// Below the last title there is nothing to select.
	before := m.cursor
	m = press(m, click(g.asideX+3, g.itemsY+40))
	if m.cursor != before {
		t.Errorf("clicking past the end moved the cursor to %d", m.cursor)
	}
}

// The source view exists to be selected with the mouse, so the app gives the
// mouse back while it is open and takes it again on the way out.
func TestSourceViewReleasesTheMouse(t *testing.T) {
	m := longNotesModel(t, "one")

	next, cmd := m.Update(key('R'))
	m = next.(model)
	if m.mode != modeRaw {
		t.Fatalf("R did not open the source view, mode = %v", m.mode)
	}
	if cmd == nil {
		t.Fatal("R returned no command; it should release the mouse")
	}
	// The message types are unexported, so compare against what the command
	// itself produces.
	if cmd() != tea.DisableMouse() {
		t.Errorf("R returned %T, want a mouse release", cmd())
	}

	next, cmd = m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if next.(model).mode != modeList {
		t.Fatal("esc did not leave the source view")
	}
	if cmd == nil {
		t.Fatal("leaving the source view returned no command; the mouse stays gone")
	}
	if cmd() != tea.EnableMouseCellMotion() {
		t.Errorf("leaving returned %T, want the mouse taken back", cmd())
	}
}

// holdsMouse reports which mouse instruction a command carries, looking inside
// a batch since a mode change usually brings other work along.
//
// Commands are identified by their function pointer, never by running them. A
// mode change can batch in the cursor blink or another timer, and running one
// of those stalls the test for as long as it ticks. The single exception is a
// batch itself, which only hands back its contents.
func holdsMouse(cmd tea.Cmd) (released, taken bool) {
	if cmd == nil {
		return false, false
	}
	is := func(c, want tea.Cmd) bool {
		return c != nil && reflect.ValueOf(c).Pointer() == reflect.ValueOf(want).Pointer()
	}
	check := func(c tea.Cmd) {
		if is(c, tea.DisableMouse) {
			released = true
		}
		if is(c, tea.EnableMouseCellMotion) {
			taken = true
		}
	}

	check(cmd)
	if released || taken {
		return released, taken
	}
	if batch, ok := cmd().(tea.BatchMsg); ok {
		for _, c := range batch {
			check(c)
		}
	}
	return released, taken
}

// While the app holds the mouse the terminal sends a burst of escape sequences
// for every scroll, and a fast scroll overruns the input parser, which spills
// the remainder as literal text. In the editor that text would be typed into
// the note, so the mouse has to go back to the terminal on the way in.
func TestEditorReleasesTheMouse(t *testing.T) {
	for _, tc := range []struct {
		name string
		open tea.Msg
	}{
		{"enter", tea.KeyMsg{Type: tea.KeyEnter}},
		{"n", key('n')},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := longNotesModel(t, "one", "two")

			next, cmd := m.Update(tc.open)
			m = next.(model)
			if m.mode != modeEdit {
				t.Fatalf("%s did not open the editor, mode = %v", tc.name, m.mode)
			}
			if released, _ := holdsMouse(cmd); !released {
				t.Error("opening the editor did not release the mouse")
			}

			next, cmd = m.Update(tea.KeyMsg{Type: tea.KeyEsc})
			if next.(model).mode != modeList {
				t.Fatal("esc did not leave the editor")
			}
			if _, taken := holdsMouse(cmd); !taken {
				t.Error("leaving the editor did not take the mouse back")
			}
		})
	}
}

// Every mode that can put a stray rune on screen, or has nothing to aim at,
// must hand the mouse back.
func TestOnlyTheNoteListHoldsTheMouse(t *testing.T) {
	for _, tc := range []struct {
		mode mode
		want bool
		why  string
	}{
		{modeList, true, "the note list has two panes to aim at"},
		{modeSearch, true, "search still shows the list"},
		{modeConfirm, true, "a confirmation is drawn over the list"},
		{modeEdit, false, "stray runes would be typed into the note"},
		{modeRaw, false, "this view exists to be selected and copied"},
		{modeTrash, false, "nothing to aim at"},
		{modeHelp, false, "nothing to aim at"},
	} {
		if got := mouseWanted(tc.mode); got != tc.want {
			t.Errorf("mouseWanted(%v) = %v, want %v — %s", tc.mode, got, tc.want, tc.why)
		}
	}
}

func TestTheStatusBarKeepsItsWidth(t *testing.T) {
	// docs/screenshot.svg draws this line by placing every character at its own
	// x position, so a change in length silently misaligns the committed
	// screenshots. Changing the wording is fine; changing the width is not,
	// unless the SVGs are regenerated in the same commit.
	const want = 95
	m, _ := newTestModel(t)
	m.mode = modeList
	bar := m.helpLine()
	if got := len([]rune(bar)); got != want {
		t.Errorf("status bar is %d characters, want %d.\n  %q\n"+
			"If this change is deliberate, regenerate docs/screenshot.svg and "+
			"update the terminal in site/index.html.", got, want, bar)
	}
}
