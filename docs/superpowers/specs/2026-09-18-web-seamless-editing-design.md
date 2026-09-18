# Seamless editing in the web UI

Status: accepted, not yet implemented

## What we are building

The web UI makes you declare that you are editing. A note opens read-only, and
writing in it means finding the **Edit** button first. None of the apps this is
measured against — Notion, Bear, Craft, Apple Notes — asks for that. You click
the text and you are typing.

This removes that declaration. A note still opens rendered, because rendered is
how a note is worth reading; clicking anywhere in it turns the pane into its
Markdown source with the cursor at the block you clicked.

What it does **not** remove is saving. See the decision below — an earlier draft
of this design deleted `Ctrl+S` and `Esc` along with the Edit button, which was
wrong.

## Decisions

**Rendered until you click in.** Opening a note renders it. Clicking the prose
switches the whole pane to source. Rejected: an always-visible source pane,
which would show the Companies table as pipes for the 90% of the time it is
being read rather than written; and a side-by-side split, which halves the
width a wide table needs.

**Markdown source, not live preview.** The write face is a plain textarea over
the raw Markdown. Rejected: Bear/Obsidian-style live preview, which needs
CodeMirror 6 — realistically 150-250 KB gzipped against a current bundle of
131 KB gzipped, inside a binary whose pitch is that it is one small file.

**`Ctrl+S` and `Esc` stay.** The terminal UI's editor footer reads
`ctrl+s save … esc cancel`. Deleting both from the web UI would make the two
halves of one app disagree about its most basic gesture, and nothing about
click-to-type requires it. Only the **Edit** button is removed, because only
the Edit button is the modality being complained about.

*Corrected during brainstorming:* the first draft of this design dropped Save
and Esc because Notion and Bear have neither. The right reference was in this
repo, not in those apps.

**Autosave as a net, not as the mechanism.** Saving also happens about 800 ms
after typing stops, and on leaving the note. `Ctrl+S` still saves on demand,
and `Esc` still discards — it restores the snapshot taken when write mode was
entered, which is one more save rather than a new mechanism. This keeps Bear's
never-lose-work property and a real discard at the same time. Rejected:
autosave alone, the only option of the three that makes web and terminal
behave differently for no gain.

**The cursor lands at the start of the block you clicked.** Not at the exact
character under the pointer. Rendered text is not the source string — `**bold**`
is eight characters displayed as four — so exact mapping drifts wherever inline
syntax appears, and drifts silently. Block starts come from the parser and
cannot drift.

## Feasibility, verified

Tested against the real libraries before this was written.

**Token offsets tile the source exactly.** Walking `marked.lexer` output and
accumulating `raw` lengths reproduces every byte:

```
   0 heading    raw matches "# Title\n\n"
   9 paragraph  raw matches "A **bold** word."
  25 space      raw matches "\n\n"
  27 table      raw matches "| # | Company |\n| - | ------"
  94 list       raw matches "- item one\n- item two\n"
total consumed: 116 of 116 (exact)
```

**List items carry `raw`; table rows do not.** A `list` token's `items` each
carry their own `raw`, so per-item offsets fall out of the same accumulation. A
`table` token exposes only `rows` of cells with `text`. Row offsets therefore
come from splitting the table's own `raw` on newlines: line 0 is the header,
line 1 the alignment row, and data row *n* is line *n+2*. This is safe because
marked only parses pipe tables, where one row is one line.

**DOMPurify keeps `data-src`.** `ALLOW_DATA_ATTR` defaults on, and the
attribute survives on `<p>` and on `<tr>`, which is the case that matters for a
40-row table. Checked in a browser, not in jsdom, because the browser is the
real environment.

## Architecture

### State

`App.jsx` holds `draft` (being edited) and `viewing` (read-only) as two
separate notes. That pair is what forces an Edit button to exist: something has
to move a note from one to the other.

They collapse into one open note plus a mode:

```js
const [note, setNote] = useState(null);       // the open note
const [mode, setMode] = useState('read');     // 'read' | 'write'
const [baseline, setBaseline] = useState(''); // content when write mode began
```

`SavedView` and `Editor` stop being alternate screens and become the two faces
of one `NotePane`, which owns the switch.

### `lib/sourceMap.js` — new

One job: given Markdown, return the byte offset of every block.

```js
// [{ start, end, type }], in document order
export function blockSpans(markdown)
```

It walks `marked.lexer` accumulating `raw` lengths, descends into `list.items`,
and splits `table.raw` by line as described above. It does not touch the DOM
and does not know what a click is, so it is testable as a pure function.

### Rendering with offsets

`renderMarkdown` gains a second pass that stamps each block element with the
offset of the span it came from, walking rendered top-level elements and
`blockSpans` in parallel:

```html
<p data-src="9">A <strong>bold</strong> word.</p>
<tr data-src="61"><td>1</td><td>Google</td></tr>
```

Sanitisation is unchanged; the attribute survives it.

### Clicking in

1. Click lands in the rendered article.
2. Walk up from `event.target` to the nearest `[data-src]`.
3. Switch to `write`, focus the textarea, set `selectionStart = selectionEnd`
   to that offset, scroll the line into view.
4. No `[data-src]` ancestor — a click on padding — focuses without moving the
   cursor rather than jumping to the top.

### Saving

| Trigger | Behaviour |
| --- | --- |
| ~800 ms after typing stops | save |
| `Ctrl+S` | save now |
| `Esc` | restore `baseline`, save that, return to `read` |
| selecting another note, or `beforeunload` | flush a pending save first |

The existing `Saved` badge becomes the live indicator: `Editing` → `Saving…` →
`Saved`, with the failure path keeping the existing error toast.

### What stays as it is

The title input, drag-and-drop and paste attachments, and the formatting
helpers in `editorActions.js` all act on a textarea, and there is still a
textarea. The note list, search, and trash are untouched.

## What this breaks

**The Edit button disappears**, which is the point, but it is a visible change
to a control that exists today.

**`updated_at` churns while you type.** Autosave writes, and the note list
sorts by most-recently-edited, so the open note can jump to the top of the list
mid-sentence. The list should not reorder while a note is in `write` mode.

**A note open in both the web UI and the TUI** can now be written from the web
without an explicit save. The TUI already reloads from disk, so this is a
sharper version of a race that exists today rather than a new one.

## Testing

- `blockSpans` returns offsets that tile the source, for a document mixing
  headings, paragraphs, fenced code, lists and a table.
- `blockSpans` gives one span per list item, and one per table data row.
- A click on a table row's rendered `<tr>` yields the offset of that row's line
  in the source, for a row well down a long table.
- A click on padding, with no `[data-src]` ancestor, does not move the cursor.
- `Esc` after edits restores the content that was there when write mode began.
- `Ctrl+S` saves without leaving write mode.
- A pending autosave is flushed when another note is selected.
- The note list does not reorder while a note is being written.

## Delivery

Three PRs, each shippable alone:

1. **`sourceMap.js` and the offset-stamping renderer.** Pure functions and
   markup, no behaviour change — the rendered view gains attributes nothing
   reads yet.
2. **`NotePane`: the read/write switch.** Collapses the two states, removes the
   Edit button, wires click-to-cursor. `Ctrl+S` and `Esc` keep their current
   meanings.
3. **Autosave and the status indicator.** The net, on top of a working
   non-modal editor.

## Deliberately out of scope

- Version history. `Esc` restores the current editing session only; nib has no
  per-note history and this does not add one.
- Live preview, and the editor engine it would require.
- Tags, pinning, date grouping, command palette — the other directions
  considered during brainstorming and not chosen.
- The reading view's typography. Prose is `max-w-none` today and so runs the
  full window width; worth fixing, but it is a separate change.
