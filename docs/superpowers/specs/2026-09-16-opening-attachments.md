# Opening attachments: a picker and clickable filenames

Status: implemented
Follows: `2026-09-16-attachments-design.md`

## What we are building

Attachments can be added and stored, and `o` opens them. What is missing is
any way to *choose*. `o` walks the note's links in document order and opens
the next one each time, so on a note with three attachments you press `o`
and find out afterwards which one you got. Nothing on screen says the chip
is openable at all.

Two changes, both about getting from "I can see the file is attached" to "I
am looking at the file":

1. **A picker.** `o` lists what the note holds and lets you pick.
2. **Ctrl+click.** The filename on screen becomes a real terminal hyperlink,
   so clicking it opens the file with no keyboard at all.

They are one feature: both need the same ordered list of openable things, and
building either one alone would mean building that list twice.

## The problem, concretely

This is the note that prompted it:

```
System Design

Book - [file System Design Interview by Alex Xu (1).pdf]
```

The chip reads like a label. There is no underline, no colour that separates
it from body text, no hint that a key does anything. The status bar says
`o open`, which is true but does not connect to the thing on screen.

## Decisions

**The picker is the primary fix, Ctrl+click is the delight.** Ctrl+click only
works in terminals that implement OSC 8, and it needs a mouse. The picker
works everywhere and on the keyboard, so it carries the feature; clicking is
what makes it feel direct. Rejected: shipping only Ctrl+click, which would
leave `o` as blind as it is now for anyone in a terminal without OSC 8.

**One openable target list, two consumers.** A single function returns the
note's openable things in document order, each with the label as rendered and
the target as resolved. The picker renders that list; the OSC 8 pass pairs
against it. Rejected: letting each feature parse the markdown itself, which
guarantees they drift and disagree about ordering.

**`o` keeps its key.** `o` opens the picker rather than firing immediately.
The muscle memory is preserved and the blind-cycling behaviour goes away.
Rejected: a new key for the picker, which leaves two ways to open things and
keeps the confusing one.

**One target opens straight away.** A note with a single attachment opens it
on `o` with no menu — a chooser with one row is friction, not a choice.
The flash message still names what was opened.

**No click coordinate tracking.** The terminal resolves an OSC 8 click
itself, so `nib` never sees it and needs no idea where anything was drawn.
Rejected: tracking rendered link positions and matching clicks against them.

Corrected while implementing: an earlier draft of this spec said mouse
reporting was not enabled. It is — `main.go:68` passes
`tea.WithMouseCellMotion()`, and clicks already aim panes and select rows in
the list. The consequence is that a *plain* click on a hyperlink goes to the
app, not the terminal, so opening one needs ctrl (shift in some terminals) to
reach the terminal's own handling. That caveat already applied to ordinary
links and is already written in the help text; attachments inherit it. It is
the reason the picker carries the feature and clicking is the shortcut.

**Images are targets too.** An `![img]` chip is as openable as a file chip,
and opens in the system image viewer. The existing `OrderedTargets` skips
images because it pairs against link styling; the new list must not.

## Feasibility, verified

Both claims below were tested against the real renderer before this was
written, not reasoned about.

**OSC 8 cannot be injected before glamour.** Putting the escape into the
markdown and rendering produces this:

```
\x1b]8;;f
ile:///home/prathmesh/.
local/share/nib/attachments/1556d7a7cbcc1ec8.pdf
```

Glamour v1.0.0 wraps with `muesli/reflow`, which does not know OSC 8. It
counts the URL as visible characters and word-wraps inside the escape, so the
URL prints on screen and no link forms. Glamour has no native hyperlink
support — there is no `]8;;` anywhere in the module.

**OSC 8 applied after glamour works.** A proof of concept rendered the note
body, then walked each output line mapping visible runes to byte offsets and
wrapped the chip's run in the escape. Visible text came back byte-identical,
the URL did not appear in it, every line's `ansi.StringWidth` was unchanged,
and glamour's own colour codes survived inside the hyperlink.

**Superseded: the repository had already solved this.** `internal/osc8.go`
exists on main from "Make link text clickable with real terminal hyperlinks",
and it does something simpler than the proof of concept. Glamour's own style
config takes a prefix and suffix for link text, so link runs are tagged with
two single bytes (`\x01`, `\x02`) *before* rendering — bytes glamour wraps as
ordinary text without mangling — and the escapes are swapped in afterwards by
scanning for the markers. No offset table, no width arithmetic. The offset
mapping in the proof of concept was therefore not used; this spec keeps it
only as the record of what was tested.

**Width measurement is already correct.** `lipgloss.Width` and
`ansi.StringWidth` both report 49 for a wrapped chip whose visible text is 49
characters, so `charmbracelet/x/ansi` treats the escape as zero-width. No
layout maths needs changing.

## Architecture

### The target list

```go
type Target struct {
    Label string // as it appears on screen, e.g. "file System Design ....pdf"
    Open  string // what goes to the system opener
    Kind  Kind   // file, image or link
}

func (m model) Targets(md string) []Target
```

Built by walking the note once, in document order, mirroring exactly what
`attachmentChips` and `hideLinkTargets` do to the same text, so labels match
what the renderer will print. Attachment targets go through the existing
`resolveTarget`; plain links pass through untouched.

### The picker

A new `modePick` sitting over the note view. It holds the targets, a cursor,
and renders a bordered panel:

```
╭─ Open ────────────────────────────────────────╮
│ ▸ 1  file  System Design Interview by Alex Xu.pdf │
│   2  img   Screenshot From 2026-09-13.png         │
│   3  link  https://github.com                     │
╰─ ↑↓ select · ↵ open · esc cancel ─────────────╯
```

Long labels truncate from the middle so the extension stays visible. Number
keys 1-9 open directly. `esc` returns to the note having done nothing.

`m.linkCursor` and its wrap-around bookkeeping are deleted — with a picker
there is nothing to cycle through.

### Making attachments clickable

No new pass is needed. Link text is already tagged and swapped for escapes by
`linkifyRendered`; attachments simply never reached it, for two reasons, both
of which are one-line consequences of how chips were written:

- A chip was written as **plain text** (`[file report.pdf]`), so glamour saw
  no link and tagged nothing. Chips are now written as a link to a bare anchor
  (`[file report.pdf](#)`), which tags them like any other.
- `openable` admitted only `http`, `https` and `mailto`. A target that is an
  absolute path is now clickable too, rendered as a `file://` URL built with
  `net/url` so a path containing spaces survives.

### The alignment bug this exposed

`linkifyRendered` pairs the *n*th tag with the *n*th entry of a target list
that was built by a separate walk of the note (`OrderedTargets`). Once chips
stopped being links, the two walks disagreed: three links in a note produced
three targets but only two tags, so every link written after an attachment was
paired with the wrong destination and — because an attachment path failed
`openable` — silently stopped being clickable. Measured on main before the
fix, then again after.

The fix is structural rather than a correction: `prepareForRender` does the
rewriting and the target collection in **one pass**, returning both, so the
two cannot drift. `hideLinkTargets`, `attachmentChips`, `OrderedTargets` and
`Links` are all subsumed by it and deleted; their test cases are ported rather
than dropped. A test asserts tag count equals target count across a table of
notes mixing links, anchors, images and attachments.

## What this breaks

**`o` no longer opens immediately** on notes with more than one target. This
is the point of the change, but it is a behaviour change to a key that exists
today.

**Four functions are deleted.** `hideLinkTargets`, `attachmentChips`,
`OrderedTargets` and `Links` are all subsumed by `prepareForRender` and
`openableIn`. None had callers outside the package.

**The status bar stays 95 characters.** `o open` already says the right
thing and the width test pins it. No status bar change.

## Testing

- `Targets` returns the right list, in document order, for a note mixing
  files, images and plain links — including a note with none.
- A single-target note opens directly; a multi-target note enters `modePick`.
- Picker navigation: cursor bounds, number keys, `esc` opening nothing.
- `linkify` preserves visible text byte-for-byte and every line's
  `ansi.StringWidth` — the PoC's assertions, as real tests.
- `linkify` never emits a URL into visible text.
- A label wrapped across two lines produces two same-id runs.
- A note with no attachments renders byte-identically to today, proving the
  pass is inert when there is nothing to link.

## Delivery

Two PRs, in this order, each shippable alone:

1. **The target list and the picker.** The user-visible fix, complete on its
   own. Keyboard only.
2. **The OSC 8 pass.** Pure addition on top; touches the render pipeline and
   nothing the picker owns.

## Deliberately out of scope

- Click coordinate tracking, for the reason above.
- Rendering images inline in the terminal. That needs kitty/iTerm2/sixel
  protocols, and the target terminal here advertises none of them.
- A preview pane inside `nib`. Opening in the system viewer is the feature;
  reimplementing a PDF reader is not.
- Changing how the web UI opens attachments — it already uses real links.
