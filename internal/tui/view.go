package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

func (m model) View() string {
	switch m.mode {
	case modeRaw:
		// Deliberately bare: no panes, no borders, no padding, so selecting
		// these lines with the mouse yields exactly the note's Markdown.
		return m.rawView.View() + "\n" + helpStyle.Render(m.helpLine())
	case modeConfirm:
		// Draw whatever is being asked about, with the question in the footer.
		if m.confirmReturn == modeTrash {
			return m.trashView()
		}
		return m.listView()
	case modeTrash:
		return m.trashView()
	case modeHelp:
		return m.helpView()
	case modePick:
		return m.pickView()
	case modeEdit:
		return m.editView()
	default:
		return m.listView()
	}
}

func (m model) listView() string {
	l := m.geometry()
	inner, previewWidth := l.inner, l.previewWidth

	header := "Preview"
	if n := m.selected(); n != nil {
		header = n.Title
	}

	// The bar sits inside the pane, so the text is one column narrower than the
	// pane. It stays blank when the whole note already fits.
	scrolled := withScrollbar(
		m.preview.View(),
		m.preview.Height,
		m.preview.TotalLineCount(),
		m.preview.YOffset,
	)

	docStyle, listStyle := focusedPane, paneStyle
	if m.focus == paneList {
		docStyle, listStyle = paneStyle, focusedPane
	}

	note := docStyle.
		Width(previewWidth).
		Height(inner).
		Render(titleStyle.Render(truncate(header, previewWidth-4)) + "\n" + scrolled)

	// The right-hand column: a small box of facts about the note being read,
	// and the list of notes filling everything beneath it.
	listRows := l.listRows

	details := paneStyle.
		Width(asideWidth).
		Height(asideDetailRows).
		Render(m.asideDetails())

	list := listStyle.
		Width(asideWidth).
		Height(listRows).
		Render(m.asideList(listRows))

	aside := lipgloss.JoinVertical(lipgloss.Left, details, list)
	body := lipgloss.JoinHorizontal(lipgloss.Top, note, aside)

	if m.mode == modeSearch {
		return body + "\n" + m.search.View() + "\n" + helpStyle.Render(" "+m.helpLine())
	}
	return body + "\n" + m.footer()
}

// asideList is the note list as it appears in the top-right box.
func (m model) asideList(rows int) string {
	if len(m.notes) == 0 {
		empty := "No notes yet."
		if m.search.Value() != "" {
			empty = "Nothing matches."
		}
		return titleStyle.Render("Notes") + "\n\n" + dimStyle.Render(" "+empty)
	}

	var b strings.Builder
	b.WriteString(titleStyle.Render(fmt.Sprintf("Notes (%d)", len(m.notes))) + "\n")

	// Keep the cursor in view by sliding the window of titles.
	start, end := m.geometry().window(m.cursor, len(m.notes))

	for i := start; i < end; i++ {
		label := truncate(m.notes[i].Title, asideWidth-5)
		if i == m.cursor {
			b.WriteString(cursorStyle.Render("▸ ") + selectedStyle.Render(label))
		} else {
			b.WriteString("  " + label)
		}
		if i < end-1 {
			b.WriteString("\n")
		}
	}
	return b.String()
}

// asideDetails is the small box at the top of the right-hand column: three
// lines of fact about the note being read, each a label and a value.
func (m model) asideDetails() string {
	n := m.selected()
	if n == nil {
		return dimStyle.Render("Nothing selected.")
	}

	row := func(label, value string) string {
		return dimStyle.Render(fmt.Sprintf("%-7s", label)) + " " +
			truncate(value, asideWidth-12)
	}

	tasks := "none"
	if done, total := countTasks(n.Content); total > 0 {
		tasks = fmt.Sprintf("%d of %d done", done, total)
	}

	words := len(strings.Fields(n.Content))
	return strings.Join([]string{
		row("Edited", relativeTime(n.UpdatedAt)),
		row("Tasks", tasks),
		row("Length", fmt.Sprintf("%d words", words)),
	}, "\n")
}

func (m model) editView() string {
	label := titleStyle.Render("New note")
	if m.editing != nil {
		label = titleStyle.Render("Editing") + dimStyle.Render(" · "+relativeTime(m.editing.UpdatedAt))
	}

	titleBox := paneStyle.Width(m.width - 4).Render(m.title.View())
	if m.focusTitle {
		titleBox = focusedPane.Width(m.width - 4).Render(m.title.View())
	}

	if m.previewDraft {
		label += dimStyle.Render("  ·  preview")
		box := focusedPane.Width(m.width - 4).Render(m.draft.View())
		return " " + label + "\n" + titleBox + "\n" + box + "\n" + m.footer()
	}

	bodyBox := focusedPane.Width(m.width - 4).Render(m.body.View())
	if m.focusTitle {
		bodyBox = paneStyle.Width(m.width - 4).Render(m.body.View())
	}

	return " " + label + "\n" + titleBox + "\n" + bodyBox + "\n" + m.footer()
}

func (m model) trashView() string {
	inner := m.height - 4
	if inner < 3 {
		inner = 3
	}

	var b strings.Builder
	b.WriteString(titleStyle.Render(fmt.Sprintf("Trash (%d)", len(m.trash))) + "\n")
	b.WriteString(dimStyle.Render("Deleted notes are kept for 30 days.") + "\n\n")

	if len(m.trash) == 0 {
		b.WriteString(dimStyle.Render("  The trash is empty."))
	} else {
		rows := inner - 3
		if rows < 1 {
			rows = 1
		}
		start := 0
		if m.trashCursor >= rows {
			start = m.trashCursor - rows + 1
		}
		end := min(start+rows, len(m.trash))

		for i := start; i < end; i++ {
			n := m.trash[i]
			label := truncate(n.Title, m.width-24)
			line := "  " + label
			if i == m.trashCursor {
				line = cursorStyle.Render("▸ ") + selectedStyle.Render(label)
			}
			b.WriteString(line + "\n")
		}
	}

	return paneStyle.Width(m.width-4).Height(inner).Render(b.String()) +
		"\n" + m.footer()
}

func (m model) helpView() string {
	return paneStyle.
		Width(m.width-4).
		Height(m.height-4).
		Render(m.help.View()) + "\n" + helpStyle.Render(" "+m.helpLine())
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// pickView lists what the selected note holds, so "o" is a choice rather than
// a guess. The tag in front of each row says what opening it will do.
func (m model) pickView() string {
	inner := m.height - 4
	if inner < 3 {
		inner = 3
	}

	var b strings.Builder
	b.WriteString(titleStyle.Render(fmt.Sprintf("Open (%d)", len(m.picks))) + "\n")
	b.WriteString(dimStyle.Render("Opens in whichever app this desktop uses for it.") + "\n\n")

	rows := inner - 3
	if rows < 1 {
		rows = 1
	}
	start := 0
	if m.pickCursor >= rows {
		start = m.pickCursor - rows + 1
	}
	end := min(start+rows, len(m.picks))

	for i := start; i < end; i++ {
		t := m.picks[i]
		// The number is the key that opens this row, so it stops being shown
		// once there is no key left to show.
		num := "  "
		if i < 9 {
			num = fmt.Sprintf("%d ", i+1)
		}
		tag := fmt.Sprintf("%-4s ", t.Kind.tag())

		// A link's text says little on its own — "link", "here" — so the
		// destination is shown beside it. A file's name already says what it
		// is, and its path is a long prefix every row would share.
		trail := ""
		if t.Kind == targetLink && t.Label != t.Open {
			trail = "  " + middleTruncate(t.Open, 40)
		}
		label := middleTruncate(t.Label, m.width-20-len([]rune(trail)))

		line := "  " + dimStyle.Render(num+tag) + label + dimStyle.Render(trail)
		if i == m.pickCursor {
			line = cursorStyle.Render("▸ ") + dimStyle.Render(num+tag) +
				selectedStyle.Render(label) + dimStyle.Render(trail)
		}
		b.WriteString(line + "\n")
	}

	return paneStyle.Width(m.width-4).Height(inner).Render(b.String()) +
		"\n" + m.footer()
}

// middleTruncate shortens from the middle, because the end of a filename is
// the part that says what it is and the start is the part that says which.
func middleTruncate(s string, width int) string {
	r := []rune(s)
	if width < 6 || len(r) <= width {
		return s
	}
	keep := width - 1
	head := (keep + 1) / 2
	tail := keep - head
	return string(r[:head]) + "…" + string(r[len(r)-tail:])
}
