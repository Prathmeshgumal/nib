package tui

import (
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// autosaveDelay is how long typing has to stop before the draft is written.
// The same pause as the web editor uses, so the two feel like one program.
const autosaveDelay = 800 * time.Millisecond

// autosaveMsg asks for the draft to be written.
//
// gen says which edit the write was scheduled for. Bubble Tea hands the model
// to Update by value, so a timer cannot hold on to the editor and look at it
// later - by the time it fires, the model it closed over is a copy that has
// already been thrown away. Carrying the generation instead lets the write
// check, against the model that actually receives the message, whether
// anything has been typed since.
type autosaveMsg struct{ gen int }

// scheduleAutosave records that the draft has changed and asks for it to be
// written once typing stops.
func (m *model) scheduleAutosave() tea.Cmd {
	m.gen++
	gen := m.gen
	return tea.Tick(autosaveDelay, func(time.Time) tea.Msg {
		return autosaveMsg{gen: gen}
	})
}

// autosave writes the draft where it stands and leaves the editor open.
//
// It deliberately does none of what save does besides the write: no reload, no
// change of mode, no keepID. The list is ordered most-recently-edited first,
// so reloading it here would lift the open note to the top and slide the
// selection out from under the cursor every time the typist paused.
func (m *model) autosave() tea.Cmd {
	title, content := m.title.Value(), m.body.Value()

	if m.editing == nil {
		// A new note that is still blank is not a note yet. Creating one here
		// would leave an empty note behind every time the editor was opened
		// and closed again.
		if strings.TrimSpace(title) == "" && strings.TrimSpace(content) == "" {
			return nil
		}
		saved, err := m.st.Create(title, content)
		if err != nil {
			m.err = err
			return nil
		}
		// Remember what was created, or the next autosave makes a second copy.
		m.editing = &saved
		m.autosaved = true
		m.savedGen = m.gen
		return nil
	}

	if _, err := m.st.Update(m.editing.ID, title, content); err != nil {
		m.err = err
		return nil
	}
	m.autosaved = true
	m.savedGen = m.gen
	return nil
}

// leaveEdit is escape: close the editor, keeping what was written.
//
// Autosave has been writing all along, but the last second of typing may not
// have reached the note yet, so the draft goes in before the editor closes.
//
// Escape used to throw the session away, and briefly - once the note was
// saving itself - it put the note back to how it had been. Both of those make
// the one key a hand reaches for to mean "I am done here" into a key that can
// cost you an afternoon. It keeps the writing instead. Taking back an edit is
// what undo and the thirty-day trash are for.
func (m *model) leaveEdit() tea.Cmd {
	m.autosave()
	if !m.autosaved {
		// An empty new note: nothing was ever written, so there is nothing to
		// show in the list and nothing to say about it.
		return nil
	}
	return tea.Batch(m.reload(), flash("Saved"))
}

// draftText is everything the editor is holding, as one string to compare
// against itself a moment later. The separator cannot appear in either field,
// so no edit can move a character across the join and look like no change.
func (m model) draftText() string {
	return m.title.Value() + "\x00" + m.body.Value()
}

// draftState is the word the editor shows for whether what is on screen has
// reached the note yet.
//
// There is no "saving" in between. The write is a local SQLite statement that
// finishes in well under a frame, so a third state would be a word nobody ever
// sees, claiming a delay that is not there.
func (m model) draftState() string {
	if m.gen == m.savedGen {
		return "saved"
	}
	return "unsaved"
}
