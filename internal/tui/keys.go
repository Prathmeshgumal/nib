package tui

type mode int

const (
	modeList mode = iota
	modeSearch
	modeEdit
	modeConfirm
	modeHelp
	modeTrash
	modeRaw
)

// helpLine is the context-sensitive hint bar along the bottom.
func (m model) helpLine() string {
	switch m.mode {
	case modeSearch:
		return "type to filter   ↵ accept   esc clear"
	case modeEdit:
		if m.previewDraft {
			return "ctrl+p back to writing   ctrl+s save   esc cancel"
		}
		return "ctrl+s save  ctrl+p preview  ctrl+b bold  alt+i italic  ctrl+k link  ? in help: all keys  esc cancel"
	case modeConfirm:
		return "y confirm   n / esc cancel"
	case modeRaw:
		return "select with the mouse, then ctrl+shift+c   ↑/↓ scroll   esc back"
	case modeTrash:
		return "w/s move   ↵ restore   d delete for good   E empty trash   esc back"
	case modeHelp:
		return "↑/↓ scroll   esc close"
	default:
		return "w/s note  j/k scroll  ↵ edit  n new  / search  R source  o link  d trash  W web  ? help  q quit"
	}
}

const helpText = `
  nib — keys

  Choosing a note
    s            next note
    w            previous note
    g / G        first / last note
    /            search, esc to clear

  Reading a long note
    j / k        scroll a line, down / up
    space / b    scroll a page          pgup / pgdn  the same
    ctrl+d / u   scroll half a page
    home / end   jump to the top / bottom

  The arrows and the wheel follow the mouse
    click        a pane to aim at it — the note, or the list. Whichever you
                 clicked last is the one ↑/↓ and the wheel act on, and it is
                 the pane wearing the bright border
    click        a title in the list to open it

                 w/s and j/k ignore all this. They always mean "another note"
                 and "scroll this one", so there is always a key whose effect
                 does not depend on where the mouse has been.

                 Selecting text here needs shift held down while you drag,
                 because the app is holding the mouse. It only holds it on this
                 screen: the editor, the trash, the help and R all give it
                 straight back, so selecting in those is normal.

  Copying
    R            the Markdown source, full-screen and borderless. The app
                 releases the mouse here, so select it and copy the way you
                 always do, with no modifier — ctrl+shift+c in most Linux
                 terminals, cmd+c on a Mac.

  Writing
    n            new note
    ↵            edit the selected note
    e            edit it straight in $EDITOR

  While editing
    ctrl+s       save                  tab      switch title / body
    ctrl+p       preview the draft     ctrl+e   hand it to $EDITOR
    esc          discard

  Lists carry on by themselves
    ↵            at the end of a list item, starts the next one:

                   - [ ] buy milk   ↵   →   - [ ]
                   - [x] buy milk   ↵   →   - [ ]   (new tasks start unticked)
                   - buy milk       ↵   →   -
                   1. first         ↵   →   2.      (and keeps counting)
                   > a thought      ↵   →   >

                 indentation is kept, so a nested item stays nested

    ↵ again      on the empty item it just made, removes the marker —
                 that is how a list is finished

    alt+↵        a plain line break, leaving the list alone. Shift+Enter
                 cannot do this: a terminal sends the same byte for it as
                 for Enter, so no program inside one can tell them apart

  Formatting, while editing the body
    ctrl+b       bold          alt+l    bulleted list
    alt+i        italic        alt+o    ordered (numbered) list
    alt+s        strikethrough alt+t    task list
    alt+c        inline code   alt+x    tick / untick a task
    alt+f        code block    alt+r    horizontal rule
    ctrl+k       link          alt+h    heading (press again for deeper)
    alt+q        blockquote

    Most are alt+ because a terminal spends the control range on its own
    codes: ctrl+i is Tab, ctrl+h is Backspace, ctrl+m is Enter. They are
    letters not digits because terminals bind alt+1..9 to switching tabs,
    so a digit never reaches a program running inside one.

  Other
    o            open a link from this note (again for the next one).
                 The links are real terminal hyperlinks, but while the app is
                 holding the mouse most terminals send the click here instead
                 of opening it, so o is the dependable route
    d            move to trash (asks first)
    u            undo the last delete (again for the one before it)
    T            the trash — restore anything deleted in the last 30 days
                 in it: ↵ restore, d delete for good, E empty it
    W            start the web UI and open a browser
    r            reload from disk
    ?            this help
    q / ctrl+c   quit
`
