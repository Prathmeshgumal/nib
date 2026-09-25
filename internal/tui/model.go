// Package tui is the terminal interface: a two-pane, keyboard-driven view of
// the notes, in the spirit of lazygit.
package tui

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/glamour/ansi"
	"github.com/charmbracelet/glamour/styles"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/reflow/wordwrap"
	"github.com/muesli/reflow/wrap"

	"github.com/Prathmeshgumal/nib/internal/store"
	"github.com/Prathmeshgumal/nib/internal/web"
)

// The list sits in a box in the top-right corner, so the note itself gets the
// rest of the screen. Narrower than the old full-height sidebar, which is where
// the extra room for the note comes from.
// Which pane the arrows and the mouse wheel act on. Clicking a pane focuses
// it; w/s and j/k ignore this and always do the one thing they say.
type pane int

const (
	paneDoc pane = iota // the note being read
	paneList
)

const (
	asideWidth = 26
	// What is known about the note is a fixed three lines, so it takes a small
	// box at the top and the list of notes gets everything below it.
	asideDetailRows = 3
)

type model struct {
	st    *store.Store
	notes []store.Note

	cursor int
	mode   mode
	focus  pane
	width  int
	height int

	search  textinput.Model
	title   textinput.Model
	body    textarea.Model
	preview viewport.Model

	editing    *store.Note // nil while composing a brand-new note
	gen        int         // counts edits, so a stale autosave can tell
	focusTitle bool

	// What the note said when the editor opened, and what has happened to it
	// since. Autosave overwrites the note as you type, so escape can only mean
	// "put it back" if the editor remembers what back was.
	origTitle    string
	origContent  string
	autosaved    bool // an autosave has written at least once
	created      bool // the note exists only because an autosave made it
	savedGen     int  // the edit the note on disk is up to date with
	previewDraft bool // showing the draft rendered, rather than its source
	draft        viewport.Model
	rawView      viewport.Model // full-screen Markdown source, for selecting
	rawSource    string         // that view's text before wrapping, to rewrap on resize
	help         viewport.Model // the key list, which is longer than a screen

	server *web.Server
	status string
	err    error

	deleted     []string // ids of deletes, newest last, for repeated undo
	keepID      string   // note to keep selected across the next reload
	trash       []store.Note
	trashCursor int

	// A pending yes/no question. The action is described rather than held as
	// a closure: the model is passed by value, so a closure would mutate a
	// copy that has already been discarded by the time the answer arrives.
	confirmPrompt string
	confirmKind   confirmKind
	confirmID     string
	confirmReturn mode

	// What "o" found in the selected note, and which row of it is highlighted,
	// while the picker is up.
	picks      []Target
	pickCursor int

	// Rendering Markdown is the expensive part of moving the cursor, so the
	// renderer is built once per width and the output cached per note.
	renderer      *glamour.TermRenderer
	rendererWidth int
	glamourStyle  string
	rendered      map[string]string
}

type reloadedMsg struct {
	notes []store.Note
	err   error
}

type trashLoadedMsg struct {
	notes []store.Note
	err   error
}

type statusMsg string

type clearStatusMsg struct{}

func New(st *store.Store) model {
	search := textinput.New()
	search.Prompt = "/"
	search.Placeholder = "search"

	title := textinput.New()
	title.Prompt = ""
	title.Placeholder = "Title (blank uses the first line)"
	title.CharLimit = 200

	body := textarea.New()
	body.Placeholder = "Write in Markdown…"
	body.ShowLineNumbers = false
	body.CharLimit = 0
	// A note has no business being limited by the editor's defaults. The
	// height cap is the damaging one: pasted text ignores it, but Enter is
	// refused once the note reaches it, so a long pasted note silently stops
	// accepting new lines. Zero means no limit for both.
	body.MaxHeight = 0
	body.MaxWidth = 0

	// Ask the terminal about its background exactly once. Doing this per
	// render (via glamour's auto style) stalls every keypress.
	glamourStyle := "dark"
	if !lipgloss.HasDarkBackground() {
		glamourStyle = "light"
	}

	m := model{
		st:           st,
		glamourStyle: glamourStyle,
		rendered:     map[string]string{},
		search:       search,
		title:        title,
		body:         body,
		preview:      viewport.New(0, 0),
		draft:        viewport.New(0, 0),
		rawView:      viewport.New(0, 0),
		help:         viewport.New(0, 0),
		mode:         modeList,
		// Sensible defaults so the first frame renders even if the terminal
		// never reports its size; WindowSizeMsg overrides these.
		width:  80,
		height: 24,
	}
	m.layout()
	// Load synchronously so the first frame already shows the notes rather
	// than flashing an empty list.
	if notes, err := st.List(""); err == nil {
		m.notes = notes
	}
	m.renderPreview()
	return m
}

func (m model) Init() tea.Cmd { return m.reload() }

func (m model) reload() tea.Cmd {
	q := m.search.Value()
	return func() tea.Msg {
		notes, err := m.st.List(q)
		return reloadedMsg{notes: notes, err: err}
	}
}

func flash(s string) tea.Cmd {
	return tea.Batch(
		func() tea.Msg { return statusMsg(s) },
		tea.Tick(3*time.Second, func(time.Time) tea.Msg { return clearStatusMsg{} }),
	)
}

func (m *model) selected() *store.Note {
	if m.cursor < 0 || m.cursor >= len(m.notes) {
		return nil
	}
	return &m.notes[m.cursor]
}

// moveCursor changes the selected note and resets everything tied to it.
func (m *model) moveCursor(delta int) {
	next := m.cursor + delta
	if next < 0 || next >= len(m.notes) {
		return
	}
	m.cursor = next
	m.renderPreview()
}

func (m *model) layout() {
	if m.width == 0 {
		return
	}
	paneHeight := m.height - 2 // status + help lines
	if paneHeight < 3 {
		paneHeight = 3
	}
	previewWidth := m.width - asideWidth - 4
	if previewWidth < 20 {
		previewWidth = 20
	}
	m.preview.Width = previewWidth - 1 // one column for the scrollbar
	m.preview.Height = paneHeight - 3

	m.draft.Width = m.width - 6
	m.draft.Height = paneHeight - 4

	// Full width, no borders: a mouse selection here is the note and nothing
	// else. One line is left for the hint along the bottom.
	m.rawView.Width = m.width
	m.rawView.Height = m.height - 1
	if m.rawSource != "" {
		m.rawView.SetContent(wrapSource(m.rawSource, m.rawView.Width))
	}

	// The key list is longer than any terminal, so it scrolls.
	m.help.Width = m.width - 4
	m.help.Height = m.height - 4
	m.help.SetContent(helpText)

	m.title.Width = m.width - 6
	m.body.SetWidth(m.width - 6)
	m.body.SetHeight(paneHeight - 4)
	m.search.Width = m.width - 6
}

// renderPreview turns the selected note's Markdown into styled terminal output.
// Results are cached: moving the cursor must not re-render or re-detect colours.
func (m *model) renderPreview() {
	n := m.selected()
	if n == nil {
		m.preview.SetContent(dimStyle.Render("\n  No note selected."))
		return
	}
	width := m.preview.Width
	if width < 20 {
		width = 20
	}

	// The width is settled before the cache is consulted, not after. Cached
	// output was wrapped for the width it was rendered at, so looking it up
	// first returns the old wrapping and returns before the check below could
	// have thrown it away. That is what left the first frame wrapped narrow:
	// a note rendered once before the terminal's real size arrived, and every
	// later render was a cache hit until an edit changed the key.
	if m.renderer == nil || m.rendererWidth != width {
		r, err := newRenderer(m.glamourStyle, width-2)
		if err != nil {
			m.preview.SetContent(n.Content)
			return
		}
		m.renderer = r
		m.rendererWidth = width
		m.rendered = map[string]string{}
	}

	if cached, ok := m.rendered[n.ID+"\x00"+n.UpdatedAt]; ok {
		m.preview.SetContent(cached)
		m.preview.GotoTop()
		return
	}

	body := stripDerivedTitle(n.Content, n.Title)
	prepared, targets := m.prepareForRender(body)
	out, err := m.renderer.Render(separateListGroups(prepared))
	if err != nil {
		m.preview.SetContent(n.Content)
		return
	}
	// Wrap the tagged link text now that the layout is already measured.
	out = linkifyRendered(out, targets)
	m.rendered[n.ID+"\x00"+n.UpdatedAt] = out
	m.preview.SetContent(out)
	m.preview.GotoTop()
}

// newRenderer builds the Markdown renderer the preview uses. Tests render
// through this too, so what they assert on is what the reader sees.
func newRenderer(style string, width int) (*glamour.TermRenderer, error) {
	return glamour.NewTermRenderer(
		glamour.WithStyles(markedUpStyle(style)),
		glamour.WithWordWrap(width),
		// A single newline is a line break, as in a Gist and as in this app's
		// own web UI. Without this the renderer joins the lines into one.
		glamour.WithPreservedNewLines(),
	)
}

// markedUpStyle is the renderer's own style with link text tagged, so the
// clickable escapes can be wrapped around it once rendering is done.
func markedUpStyle(name string) ansi.StyleConfig {
	cfg := styles.DarkStyleConfig
	if name == "light" {
		cfg = styles.LightStyleConfig
	}
	cfg.LinkText.Prefix = linkOpenMarker
	cfg.LinkText.Suffix = linkCloseMarker

	// GitHub hides the bullet on a task item (list-style-type:none) and puts
	// the checkbox in the marker's place. Here the bullet is kept and the box
	// follows it, which was asked for: a task then reads as a list item first
	// and a checkbox second. The cost is that task text sits two columns right
	// of plain bullet text, since the line carries two markers rather than one.
	//
	// The box is drawn with ASCII brackets rather than ☐/☑. Those are narrow
	// by the Unicode tables, but common monospace fonts do not carry them, and
	// the substituted glyph is drawn wide, which swallows the space after the
	// box. Brackets cannot be substituted, and a green ✓ inside makes a
	// finished task read at a glance. The escape is written into the marker
	// because glamour renders a task prefix with the surrounding block's
	// style, so the Task style's own colour never reaches it.
	cfg.Task.Ticked = "• [" + tickMark + "] "
	cfg.Task.Unticked = "• [ ] "

	return cfg
}

func (m *model) startEdit(n *store.Note) {
	m.mode = modeEdit
	m.focusTitle = false
	m.previewDraft = false
	// A fresh session of writing: nothing has been saved by itself yet, and
	// this is what escape will put back.
	m.autosaved = false
	m.created = false
	m.savedGen = m.gen // nothing typed yet, so the note is up to date
	if n == nil {
		m.editing = nil
		m.title.SetValue("")
		m.body.SetValue("")
		m.origTitle, m.origContent = "", ""
	} else {
		cp := *n
		m.editing = &cp
		m.title.SetValue(n.Title)
		m.body.SetValue(n.Content)
		m.origTitle, m.origContent = n.Title, n.Content
	}
	m.title.Blur()
	m.body.Focus()
	m.body.CursorEnd()

	// Opening a note longer than the editor would otherwise show the top while
	// the caret sat invisibly at the end, and the first keystroke would jump.
	// CursorEnd moves the caret but not the view; the textarea only repositions
	// inside Update. Rendering once first is what makes that work — the
	// textarea fills its viewport during View, and until it has content there
	// is nothing for the reposition to scroll.
	_ = m.body.View()
	m.body, _ = m.body.Update(tea.KeyMsg{Type: tea.KeyEnd})
}

// bodyCursor is where the caret sits as an offset into the whole note.
func (m *model) bodyCursor() int {
	li := m.body.LineInfo()
	return offsetAt(m.body.Value(), m.body.Line(), li.StartColumn+li.ColumnOffset)
}

// currentLine returns the line the caret is on, and how far into it it sits.
func (m *model) currentLine() (string, int) {
	value := m.body.Value()
	off := m.bodyCursor()
	start, end := lineBounds(value, off)
	return value[start:end], off - start
}

// replaceCurrentLine swaps the caret's line for a new one and leaves the caret
// at column col of it.
//
// The obvious implementation — rewrite the whole note with SetValue — scrolls
// the editor back to the top, because SetValue resets the textarea and its
// scroll position cannot be restored from outside the package. Every formatting
// action changes a single line, so the line is edited in place instead: go to
// its start, delete forward to its end, type the replacement. The caret never
// leaves the row, so the view stays where the writer left it.
func (m *model) replaceCurrentLine(line string, col int) {
	m.body.CursorStart()
	// ctrl+k is the textarea's own "delete through the end of the line".
	m.body, _ = m.body.Update(tea.KeyMsg{Type: tea.KeyCtrlK})
	m.body.InsertString(line)
	m.body.CursorStart()
	m.body.SetCursor(col)
}

// markBody applies Markdown emphasis around the word under the caret.
func (m *model) markBody(open, close string) {
	line, col := m.currentLine()
	next, pos := mark(line, col, open, close)
	m.replaceCurrentLine(next, pos)
}

// renderDraft renders what is currently being written, so the preview shows
// unsaved work rather than the note as it was last saved.
func (m *model) renderDraft() {
	width := m.draft.Width
	if width < 20 {
		width = 20
	}
	content := m.body.Value()
	if strings.TrimSpace(content) == "" {
		m.draft.SetContent(dimStyle.Render("\n  Nothing to preview yet."))
		return
	}
	r, err := newRenderer(m.glamourStyle, width-2)
	if err != nil {
		m.draft.SetContent(content)
		return
	}
	prepared, targets := m.prepareForRender(content)
	out, err := r.Render(separateListGroups(prepared))
	if err != nil {
		m.draft.SetContent(content)
		return
	}
	m.draft.SetContent(linkifyRendered(out, targets))
	m.draft.GotoTop()
}

// applyLine runs one of the line-based formatting helpers on the caret's line.
func (m *model) applyLine(fn func(string, int) (string, int)) {
	line, col := m.currentLine()
	next, pos := fn(line, col)

	// A horizontal rule is the one action that adds lines rather than changing
	// the current one; the rest stay within it.
	if strings.Contains(next, "\n") {
		head, tail, _ := strings.Cut(next, "\n")
		m.replaceCurrentLine(head, len(head))
		m.body.CursorEnd()
		m.body.InsertString("\n" + tail)
		return
	}
	m.replaceCurrentLine(next, pos)
}

// newLine handles Enter in the body: inside a list it carries the list on, and
// on an item with nothing in it the marker is cleared instead, ending the list.
// Anywhere else it is an ordinary line break.
func (m *model) newLine() {
	line, _ := m.currentLine()
	prefix, endList := continuation(line)

	if endList {
		// The writer pressed Enter on an empty item: drop the marker and leave
		// them on a blank line, rather than adding another empty item.
		m.replaceCurrentLine("", 0)
		return
	}

	m.body, _ = m.body.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if prefix != "" {
		m.body.InsertString(prefix)
	}
}

func (m *model) linkBody() {
	line, col := m.currentLine()
	next, pos := link(line, col)
	m.replaceCurrentLine(next, pos)
}

// confirmKind names what a pending yes/no question will do.
type confirmKind int

const (
	confirmNone confirmKind = iota
	confirmTrashNote
	confirmPurgeNote
	confirmEmptyTrash
)

// ask puts a yes/no question to the reader before doing something.
func (m *model) ask(kind confirmKind, id, prompt string) {
	m.confirmKind = kind
	m.confirmID = id
	m.confirmPrompt = prompt
	m.confirmReturn = m.mode
	m.mode = modeConfirm
}

// runConfirmed carries out the action the reader just agreed to.
func (m *model) runConfirmed() tea.Cmd {
	kind, id := m.confirmKind, m.confirmID
	m.confirmKind, m.confirmID, m.confirmPrompt = confirmNone, "", ""

	switch kind {
	case confirmTrashNote:
		if err := m.st.Delete(id); err != nil {
			m.err = err
			return nil
		}
		m.deleted = append(m.deleted, id)
		return tea.Batch(m.reload(), flash("Moved to trash — press u to undo"))

	case confirmPurgeNote:
		if err := m.st.Purge(id); err != nil {
			m.err = err
			return nil
		}
		return tea.Batch(m.loadTrash(), flash("Deleted for good"))

	case confirmEmptyTrash:
		n, err := m.st.EmptyTrash()
		if err != nil {
			m.err = err
			return nil
		}
		m.deleted = nil // those ids are gone; undo has nothing to return to
		return tea.Batch(m.loadTrash(), flash(fmt.Sprintf("Emptied the trash (%d notes)", n)))
	}
	return nil
}

func (m *model) loadTrash() tea.Cmd {
	return func() tea.Msg {
		notes, err := m.st.Trash()
		return trashLoadedMsg{notes: notes, err: err}
	}
}

// undo restores the most recent delete that has not been undone yet.
func (m *model) undo() tea.Cmd {
	for len(m.deleted) > 0 {
		id := m.deleted[len(m.deleted)-1]
		m.deleted = m.deleted[:len(m.deleted)-1]
		err := m.st.Restore(id)
		if err == nil {
			m.keepID = id
			return tea.Batch(m.reload(), flash("Restored"))
		}
		if !errors.Is(err, store.ErrNotFound) {
			m.err = err
			return nil
		}
		// Already restored from the trash view; try the one before it.
	}
	return flash("Nothing left to undo")
}

func (m *model) selectedTrash() *store.Note {
	if m.trashCursor < 0 || m.trashCursor >= len(m.trash) {
		return nil
	}
	return &m.trash[m.trashCursor]
}

func (m *model) restoreFromTrash() tea.Cmd {
	n := m.selectedTrash()
	if n == nil {
		return nil
	}
	if err := m.st.Restore(n.ID); err != nil {
		m.err = err
		return nil
	}
	m.keepID = n.ID
	return tea.Batch(m.loadTrash(), m.reload(), flash("Restored "+truncate(n.Title, 40)))
}

func (m *model) save() tea.Cmd {
	title, content := m.title.Value(), m.body.Value()
	if strings.TrimSpace(title) == "" && strings.TrimSpace(content) == "" {
		m.mode = modeList
		return flash("Empty note discarded")
	}
	var (
		saved store.Note
		err   error
	)
	if m.editing == nil {
		saved, err = m.st.Create(title, content)
	} else {
		saved, err = m.st.Update(m.editing.ID, title, content)
	}
	if err != nil {
		m.err = err
		return nil
	}
	// Saving moves the note to the top of the list; follow it there.
	m.keepID = saved.ID
	m.mode = modeList
	m.editing = nil
	return tea.Batch(m.reload(), flash("Saved"))
}

// externalEdit suspends the TUI, hands the body to $EDITOR, and reads it back.
func (m *model) externalEdit() tea.Cmd {
	editor := firstNonEmpty(os.Getenv("VISUAL"), os.Getenv("EDITOR"), fallbackEditor())
	if editor == "" {
		return flash("No $EDITOR set and no fallback editor found")
	}
	tmp, err := os.CreateTemp("", "note-*.md")
	if err != nil {
		m.err = err
		return nil
	}
	path := tmp.Name()
	if _, err := tmp.WriteString(m.body.Value()); err != nil {
		tmp.Close()
		m.err = err
		return nil
	}
	tmp.Close()

	parts := strings.Fields(editor)
	cmd := exec.Command(parts[0], append(parts[1:], path)...)
	return tea.ExecProcess(cmd, func(err error) tea.Msg {
		defer os.Remove(path)
		if err != nil {
			return statusMsg("Editor exited: " + err.Error())
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return statusMsg("Could not read the file back")
		}
		return editorDoneMsg(string(data))
	})
}

type editorDoneMsg string

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func fallbackEditor() string {
	for _, e := range []string{"nvim", "vim", "nano", "vi"} {
		if p, err := exec.LookPath(e); err == nil {
			return p
		}
	}
	return ""
}

// openTargets is what "o" does: it opens the one thing a note holds, or asks
// which one when there is more than one. Opening them in turn and hoping was
// the old behaviour, and it meant pressing the key to find out what it did.
func (m *model) openTargets() tea.Cmd {
	n := m.selected()
	if n == nil {
		return nil
	}
	targets := m.openableIn(n.Content)

	switch len(targets) {
	case 0:
		return flash("Nothing to open in this note")
	case 1:
		return m.open(targets[0])
	}
	m.picks = targets
	m.pickCursor = 0
	m.mode = modePick
	return nil
}

// open hands one target to the system and says so.
func (m *model) open(t Target) tea.Cmd {
	openBrowser(t.Open)
	return flash("Opened " + t.Open)
}

// openableIn is everything in a note worth handing to the system opener, in
// the order it appears: the marked-up links and attachments first, then any
// URL written out in full.
func (m model) openableIn(md string) []Target {
	_, marked := m.prepareForRender(md)
	out := openableTargets(marked)
	return append(out, bareURLTargets(md, out)...)
}

// openableTargets drops what the picker has no business offering. An anchor
// points inside the note itself, and the same destination written twice is
// still one thing to open.
func openableTargets(in []Target) []Target {
	seen := map[string]bool{}
	var out []Target
	for _, t := range in {
		if !t.clickable() || seen[t.Open] {
			continue
		}
		seen[t.Open] = true
		out = append(out, t)
	}
	return out
}

// bareURLTargets picks up URLs written out in full, which are links to the
// reader even though nothing in the note marks them up as one. Anything
// already covered by an inline link is left out so it is not offered twice.
func bareURLTargets(md string, have []Target) []Target {
	seen := map[string]bool{}
	for _, t := range have {
		seen[t.Open] = true
	}
	var out []Target
	eachLineOutsideCode(md, func(line string) string {
		rest := inlineLink.ReplaceAllString(line, "")
		for _, u := range bareURL.FindAllString(rest, -1) {
			u = strings.TrimRight(u, ".,;:!?")
			if u == "" || seen[u] {
				continue
			}
			seen[u] = true
			out = append(out, Target{Label: u, Open: u, Kind: targetLink})
		}
		return line
	})
	return out
}

func (m *model) toggleWeb() tea.Cmd {
	if m.server != nil {
		_ = m.server.Stop()
		m.server = nil
		return flash("Web UI stopped")
	}
	srv, err := web.New(m.st, 4321)
	if err != nil {
		m.err = err
		return nil
	}
	srv.Start()
	m.server = srv
	openBrowser(srv.URL)
	return flash("Web UI at " + srv.URL)
}

func openBrowser(url string) {
	var cmd string
	switch {
	case commandExists("xdg-open"):
		cmd = "xdg-open"
	case commandExists("open"):
		cmd = "open"
	default:
		return
	}
	_ = exec.Command(cmd, url).Start()
}

func commandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

// DefaultPath puts the database next to the user's other application data.
func DefaultPath() string {
	if p := os.Getenv("NIB_DB"); p != "" {
		return p
	}
	// The variable this shipped under before the program was renamed.
	if p := os.Getenv("NOTES_DB"); p != "" {
		return p
	}
	dir, err := os.UserHomeDir()
	if err != nil {
		return "nib.db"
	}
	return filepath.Join(dir, ".local", "share", "nib", "nib.db")
}

// LegacyPath is where notes lived when the program was called "note". Anyone
// who used it before the rename still has their notes there.
func LegacyPath() string {
	dir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, ".local", "share", "notes", "notes.db")
}

func (m model) footer() string {
	status := m.status
	if m.err != nil {
		status = errStyle.Render("error: " + m.err.Error())
	}
	if m.mode == modeConfirm && m.confirmPrompt != "" {
		status = errStyle.Render(" " + m.confirmPrompt)
	}
	if status == "" && m.server != nil {
		status = dimStyle.Render("web: " + m.server.URL)
	}
	return lipgloss.NewStyle().Width(m.width).Render(status) + "\n" +
		helpStyle.Width(m.width).Render(" "+m.helpLine())
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	if n <= 1 {
		return string(r[:n])
	}
	return string(r[:n-1]) + "…"
}

func relativeTime(iso string) string {
	t, err := time.Parse(time.RFC3339Nano, iso)
	if err != nil {
		return ""
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
}

// setRawSource fills the full-screen source view, wrapped to the window.
//
// A viewport clips what does not fit rather than wrapping it, so a long line
// used to run off the right edge with no way to see or select the rest of it.
// Wrapping is done here rather than left to the terminal because the alternate
// screen draws every line to a fixed width, so nothing soft-wraps on its own.
func (m *model) setRawSource(src string) {
	m.rawSource = src
	m.rawView.SetContent(wrapSource(src, m.rawView.Width))
}

// wrapSource breaks on spaces where it can and mid-word where it must, so a
// long URL cannot push past the edge either.
func wrapSource(s string, width int) string {
	if width < 10 {
		return s
	}
	return wrap.String(wordwrap.String(s, width), width)
}
