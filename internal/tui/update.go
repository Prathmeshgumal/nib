package tui

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
)

// mouseWanted reports whether a mode has anything to do with the mouse.
//
// Only the note list is divided into panes to aim at. Everywhere else the app
// must hand the mouse back, and not merely ignore it: while the app holds it,
// the terminal keeps sending a burst of escape sequences for every scroll, and
// a fast scroll overruns the input parser, which then spills the remainder as
// literal text. In the editor that text lands in the note you are writing.
func mouseWanted(m mode) bool {
	return m == modeList || m == modeSearch || m == modeConfirm
}

// Update runs the app's own update, then takes or releases the mouse if that
// changed which mode we are in. Doing it here rather than at each transition
// means a new mode cannot forget to.
func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	before := m.mode
	// Only worth reading while the editor is open: outside it there is no
	// draft to change, and joining the note's lines on every mouse move would
	// be a copy of the whole note for nothing.
	var draft string
	if before == modeEdit {
		draft = m.draftText()
	}
	updated, cmd := m.update(msg)
	next := updated.(model)

	// Anything that changed the draft schedules a write, whoever changed it:
	// a keystroke, a formatting key, a list carrying itself on. Asking here,
	// once, is what stops a new way of editing text quietly arriving without
	// one. Opening the editor fills the draft too, so both sides have to
	// already be in it for that to count as an edit.
	if before == modeEdit && next.mode == modeEdit && next.draftText() != draft {
		cmd = tea.Batch(cmd, (&next).scheduleAutosave())
	}

	if was, now := mouseWanted(before), mouseWanted(next.mode); was != now {
		if now {
			cmd = tea.Batch(cmd, tea.EnableMouseCellMotion)
		} else {
			cmd = tea.Batch(cmd, tea.DisableMouse)
		}
	}
	return next, cmd
}

func (m model) update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.layout()
		m.renderPreview()
		return m, nil

	case autosaveMsg:
		// Anything typed since this was scheduled has scheduled its own write,
		// so this one is stale and would only repeat work.
		if m.mode != modeEdit || msg.gen != m.gen {
			return m, nil
		}
		return m, m.autosave()

	case reloadedMsg:
		m.err = msg.err

		// Notes are listed most-recently-edited first, so the list reorders as
		// you work. Follow the note itself rather than its old position.
		want := m.keepID
		if want == "" {
			if n := m.selected(); n != nil {
				want = n.ID
			}
		}
		m.keepID = ""

		m.notes = msg.notes
		if want != "" {
			for i, n := range m.notes {
				if n.ID == want {
					m.cursor = i
					break
				}
			}
		}
		if m.cursor >= len(m.notes) {
			m.cursor = max(0, len(m.notes)-1)
		}
		m.renderPreview()
		return m, nil

	case trashLoadedMsg:
		m.err = msg.err
		m.trash = msg.notes
		if m.trashCursor >= len(m.trash) {
			m.trashCursor = max(0, len(m.trash)-1)
		}
		return m, nil

	case statusMsg:
		m.status = string(msg)
		return m, nil

	case clearStatusMsg:
		m.status = ""
		return m, nil

	case editorDoneMsg:
		m.body.SetValue(string(msg))
		return m, nil

	case tea.MouseMsg:
		return m.handleMouse(msg)

	case tea.KeyMsg:
		return m.handleKey(msg)
	}
	return m, nil
}

// handleMouse routes a click or a wheel turn.
//
// Clicking a pane focuses it, and the arrows and the wheel then act on
// whichever pane that is. The wheel arrives as a mouse event only because the
// app asks the terminal for mouse reporting; without that a terminal sends the
// wheel as bare arrow keys, which is why those two paths agree on what to do.
func (m model) handleMouse(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	// Only the note list view is divided into panes. Everywhere else — the
	// editor, the trash, the help, the bare source view — the mouse has
	// nothing to aim at.
	if m.mode != modeList && m.mode != modeSearch {
		return m, nil
	}

	switch msg.Action {
	case tea.MouseActionPress:
		switch msg.Button {
		case tea.MouseButtonLeft:
			if msg.X >= m.geometry().asideX {
				m.focus = paneList
				// Landing on a title selects it, the way clicking a row does
				// anywhere else.
				if i := m.noteAt(msg.X, msg.Y); i >= 0 && i != m.cursor {
					m.cursor = i
					m.renderPreview()
				}
			} else {
				m.focus = paneDoc
			}
		case tea.MouseButtonWheelDown:
			m.scrollBy(1)
		case tea.MouseButtonWheelUp:
			m.scrollBy(-1)
		}
	}
	return m, nil
}

// scrollBy moves the focused pane one step: through the notes, or down the
// note being read.
func (m *model) scrollBy(delta int) {
	if m.focus == paneList {
		m.moveCursor(delta)
		return
	}
	if delta > 0 {
		m.preview.LineDown(delta)
	} else {
		m.preview.LineUp(-delta)
	}
}

func (m model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Quitting always works, whatever the mode. Writing in the editor that the
	// timer has not reached yet goes in first: the whole point of saving by
	// itself is that closing the terminal is not a way to lose an afternoon.
	if msg.Type == tea.KeyCtrlC {
		if m.mode == modeEdit {
			m.autosave()
		}
		return m, tea.Quit
	}
	m.err = nil

	switch m.mode {
	case modeTrash:
		switch msg.String() {
		case "esc", "q", "T":
			m.mode = modeList
			return m, m.reload()
		case "s", "down":
			if m.trashCursor < len(m.trash)-1 {
				m.trashCursor++
			}
		case "w", "up":
			if m.trashCursor > 0 {
				m.trashCursor--
			}
		case "enter", "u", "r":
			return m, m.restoreFromTrash()
		case "d":
			if n := m.selectedTrash(); n != nil {
				m.ask(confirmPurgeNote, n.ID,
					"Delete \""+truncate(n.Title, 40)+"\" for good? This cannot be undone.")
			}
		case "E":
			if n := len(m.trash); n == 1 {
				m.ask(confirmEmptyTrash, "",
					"Permanently delete the note in the trash? This cannot be undone.")
			} else if n > 1 {
				m.ask(confirmEmptyTrash, "", fmt.Sprintf(
					"Permanently delete all %d notes in the trash? This cannot be undone.", n))
			}
		}
		return m, nil

	case modeRaw:
		switch msg.String() {
		case "esc", "q", "R":
			m.mode = modeList
		case "down", "j":
			m.rawView.LineDown(1)
		case "up", "k":
			m.rawView.LineUp(1)
		case "pgdown", " ":
			m.rawView.ViewDown()
		case "pgup", "b":
			m.rawView.ViewUp()
		case "ctrl+d":
			m.rawView.HalfViewDown()
		case "ctrl+u":
			m.rawView.HalfViewUp()
		case "home", "g":
			m.rawView.GotoTop()
		case "end", "G":
			m.rawView.GotoBottom()
		}
		return m, nil

	case modeHelp:
		switch msg.String() {
		case "down", "j":
			m.help.LineDown(1)
		case "up", "k":
			m.help.LineUp(1)
		case "pgdown", " ":
			m.help.ViewDown()
		case "pgup", "b":
			m.help.ViewUp()
		case "ctrl+d":
			m.help.HalfViewDown()
		case "ctrl+u":
			m.help.HalfViewUp()
		case "home", "g":
			m.help.GotoTop()
		case "end", "G":
			m.help.GotoBottom()
		default:
			m.mode = modeList
		}
		return m, nil

	case modePick:
		// The picker is only ever entered with rows in it, but every branch
		// below indexes into them, so an empty list would be a panic rather
		// than a wrong answer.
		if len(m.picks) == 0 {
			m.mode = modeList
			return m, nil
		}
		switch key := msg.String(); key {
		case "down", "j", "tab":
			if m.pickCursor < len(m.picks)-1 {
				m.pickCursor++
			}
		case "up", "k", "shift+tab":
			if m.pickCursor > 0 {
				m.pickCursor--
			}
		case "home", "g":
			m.pickCursor = 0
		case "end", "G":
			m.pickCursor = len(m.picks) - 1
		case "enter":
			t := m.picks[m.pickCursor]
			m.mode = modeList
			m.picks = nil
			return m, m.open(t)
		case "esc", "q", "ctrl+c":
			m.mode = modeList
			m.picks = nil
		default:
			// A number opens that row outright, which is the fastest way
			// through a short list.
			if len(key) == 1 && key[0] >= '1' && key[0] <= '9' {
				if i := int(key[0] - '1'); i < len(m.picks) {
					t := m.picks[i]
					m.mode = modeList
					m.picks = nil
					return m, m.open(t)
				}
			}
		}
		return m, nil

	case modeConfirm:
		m.mode = m.confirmReturn
		if msg.String() == "y" || msg.String() == "Y" {
			return m, m.runConfirmed()
		}
		m.confirmKind, m.confirmID, m.confirmPrompt = confirmNone, "", ""
		return m, nil

	case modeSearch:
		switch msg.Type {
		case tea.KeyEsc:
			m.search.SetValue("")
			m.search.Blur()
			m.mode = modeList
			return m, m.reload()
		case tea.KeyEnter:
			m.search.Blur()
			m.mode = modeList
			return m, nil
		}
		var cmd tea.Cmd
		m.search, cmd = m.search.Update(msg)
		m.cursor = 0
		return m, tea.Batch(cmd, m.reload())

	case modeEdit:
		// A file dragged onto the terminal arrives as a pasted path, so a
		// paste that names only existing files is an attachment rather than
		// text. Anything else falls straight through and types as it always
		// has. The title is one line of plain text, so it never imports.
		if msg.Paste && !m.focusTitle {
			if paths := droppedPaths(string(msg.Runes)); len(paths) > 0 {
				return m, m.attachDropped(paths)
			}
		}

		// Formatting works on the body only; the title is a single line.
		// These are alt+ combinations because the terminal spends most of the
		// control range on its own codes: ctrl+i is Tab, ctrl+h is Backspace,
		// ctrl+m is Enter, ctrl+q and ctrl+s are flow control.
		if !m.focusTitle {
			switch msg.String() {
			case "alt+i":
				m.markBody("*", "*")
				return m, nil
			case "alt+s":
				m.markBody("~~", "~~")
				return m, nil
			case "alt+c":
				m.markBody("`", "`")
				return m, nil
			case "alt+h":
				m.applyLine(heading)
				return m, nil
			case "alt+q":
				m.applyLine(quote)
				return m, nil
			// Letters, not digits: GNOME Terminal and others bind alt+1..9 to
			// switching tabs, so a digit never reaches the program. The digits
			// stay as aliases for terminals that do pass them through.
			case "alt+l", "alt+8":
				m.applyLine(bullet)
				return m, nil
			case "alt+o", "alt+7":
				m.applyLine(numbered)
				return m, nil
			case "alt+t":
				m.applyLine(task)
				return m, nil
			case "alt+x":
				m.applyLine(toggleTick)
				return m, nil
			case "alt+r":
				m.applyLine(rule)
				return m, nil
			case "alt+f":
				m.applyLine(codeBlock)
				return m, nil
			}
		}
		// An alt+key that reached here is not a formatting action. Swallow it
		// rather than letting the field insert the bare rune, which would type
		// an "8" for alt+8.
		if msg.Alt && msg.Type == tea.KeyRunes {
			return m, nil
		}

		switch msg.Type {
		case tea.KeyCtrlB:
			if !m.focusTitle {
				m.markBody("**", "**")
				return m, nil
			}
		case tea.KeyCtrlK:
			if !m.focusTitle {
				m.linkBody()
				return m, nil
			}
		}
		switch msg.Type {
		case tea.KeyEnter:
			if !m.focusTitle {
				if msg.Alt {
					// alt+enter is the way out of a list without ending it.
					// shift+enter cannot be used: a terminal sends the same
					// byte for it as for Enter, so the two are the same key.
					m.body, _ = m.body.Update(tea.KeyMsg{Type: tea.KeyEnter})
				} else {
					m.newLine()
				}
				return m, nil
			}
		case tea.KeyCtrlS:
			return m, m.save()
		case tea.KeyEsc:
			// Flush before the editor is torn down, while the draft is still
			// there to be read.
			cmd := m.leaveEdit()
			m.mode = modeList
			m.editing = nil
			m.body.Blur()
			m.title.Blur()
			return m, cmd
		case tea.KeyCtrlE:
			return m, m.externalEdit()
		case tea.KeyCtrlP:
			// Preview what is being written, the Write/Preview pair the web
			// editor has. The draft is rendered, not the saved note.
			m.previewDraft = !m.previewDraft
			if m.previewDraft {
				m.renderDraft()
			}
			return m, nil
		case tea.KeyTab:
			m.focusTitle = !m.focusTitle
			if m.focusTitle {
				m.body.Blur()
				m.title.Focus()
			} else {
				m.title.Blur()
				m.body.Focus()
			}
			return m, nil
		}
		var cmd tea.Cmd
		if m.focusTitle {
			m.title, cmd = m.title.Update(msg)
		} else {
			m.body, cmd = m.body.Update(msg)
		}
		return m, cmd
	}

	// List mode.
	switch msg.String() {
	case "q":
		return m, tea.Quit
	case "s":
		m.moveCursor(1)
	case "w":
		m.moveCursor(-1)
	case "g":
		m.cursor = 0
		m.renderPreview()
	case "G":
		m.cursor = max(0, len(m.notes)-1)
		m.renderPreview()

	// The arrows act on whichever pane was last clicked. w/s and j/k do not:
	// they always mean "another note" and "scroll this one", so there is
	// always a key whose effect does not depend on where the mouse has been.
	case "down":
		m.scrollBy(1)
	case "up":
		m.scrollBy(-1)
	case "j":
		m.preview.LineDown(1)
	case "k":
		m.preview.LineUp(1)
	case "pgdown", " ":
		m.preview.ViewDown()
	case "pgup", "b":
		m.preview.ViewUp()
	case "ctrl+d":
		m.preview.HalfViewDown()
	case "ctrl+u":
		m.preview.HalfViewUp()
	case "home":
		m.preview.GotoTop()
	case "end":
		m.preview.GotoBottom()

	case "R":
		if n := m.selected(); n != nil {
			m.mode = modeRaw
			m.setRawSource(n.Content)
			m.rawView.GotoTop()
		}
	case "enter":
		if n := m.selected(); n != nil {
			m.startEdit(n)
		}
	case "n":
		m.startEdit(nil)
	case "e":
		if n := m.selected(); n != nil {
			m.startEdit(n)
			return m, m.externalEdit()
		}
	case "/":
		m.mode = modeSearch
		m.search.Focus()
	case "d":
		if n := m.selected(); n != nil {
			m.ask(confirmTrashNote, n.ID,
				"Move \""+truncate(n.Title, 40)+"\" to the trash?")
		}
	case "o":
		return m, m.openTargets()
	case "W":
		return m, m.toggleWeb()
	case "u":
		return m, m.undo()
	case "T":
		m.trashCursor = 0
		m.mode = modeTrash
		return m, m.loadTrash()
	case "r":
		return m, tea.Batch(m.reload(), flash("Reloaded"))
	case "?":
		m.mode = modeHelp
		m.help.SetContent(helpText)
		m.help.GotoTop()
	}
	return m, nil
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
