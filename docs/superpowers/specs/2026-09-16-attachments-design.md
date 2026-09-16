# Attachments: images and files in notes

Date: 2026-09-16
Status: approved, not yet implemented

## What we are building

Dragging an image or a file into nib puts it in the note. In the web UI that is
a real drag-and-drop, and a clipboard paste as well. In the terminal it is the
gesture a terminal actually supports: dragging a file onto the window pastes its
path, and nib turns that path into an attachment.

The file is referenced from the note's markdown, inline, the way an image
normally is:

```markdown
![screenshot.png](attachments/8f3a91c2d4e5f607.png)
```

Non-images use the plain link form instead, and are otherwise identical:

```markdown
[report.pdf](attachments/2b7c0419aa3d1e88.pdf)
```

## Decisions

Recorded with their reasons, because each closed off a real alternative.

**Bytes live on disk, in `attachments/` beside the database.** The alternative
was blobs in SQLite, which would have preserved the "your notes are one file"
promise. On disk was chosen; section "What this breaks" carries the cost.

**References are relative paths, not a custom scheme.** `attachments/<id>.<ext>`
means a note exported next to its attachments folder renders correctly in
Obsidian, in VS Code, and on GitHub. A `nib://` scheme would have been
unambiguous and portable nowhere.

**Names on disk are content addresses, not original filenames.** The first 16
hex characters of the SHA-256 of the contents — 64 bits, which for a personal
notes directory is far past the point where a collision is worth designing
around. This gives deduplication for
free, and removes every collision, unicode, and path-traversal question that
comes with honouring `my photo (final) (2).png`. The original name is preserved
as the markdown link text.

**Unreferenced files go to a trash and are purged after 30 days.** Not deleted
immediately on save: a typo or a bad edit would destroy the only copy of an
image with no undo. nib already decided this for notes; attachments match it,
reusing `store.TrashRetention`.

**Any file type is accepted.** Images get the `![]()` form, everything else the
`[]()` form. The storage, lifecycle, and serving path are all type-agnostic —
restricting to images would mean writing a check on purpose to make a dropped
PDF fail.

**Clipboard images in the web UI now, in the TUI later or never.** A terminal's
bracketed paste carries text only, so image bytes in the clipboard never reach
the process; getting them means shelling out to `wl-paste`, `xclip`, or
`pbpaste`. That would be the first time nib depends on a binary outside itself,
and the store and import paths are identical whether or not we add it. Deferred
until the feature has been used enough to know it is missed.

**50 MB per file**, enforced at the store boundary so both front ends inherit
one limit. Above any screenshot, phone photo, or ordinary PDF; below the point
where a mis-dropped video copies silently for a minute.

## Feasibility, verified

Two claims this design rests on were checked against the source rather than
assumed:

- **Bubble Tea v1.3.10 supports bracketed paste.** It is enabled by default
  (`tea.go:661`) and pasted input arrives as a `KeyMsg` with `Paste: true`
  (`key.go:58`). The TUI can therefore distinguish a drag-paste from typing
  exactly, with no timing heuristics.
- **Inline images cannot be drawn in most terminals.** Doing so requires the
  kitty graphics protocol, the iTerm2 protocol, or sixel. The development
  machine reports `TERM=xterm-256color` with no `TERM_PROGRAM`, which supports
  none of them. The TUI therefore shows a chip and opens the file externally;
  drawing the image in capable terminals is possible later behind a capability
  check, and is out of scope here.

## Architecture

### `internal/attach` — a new package

It owns the attachments directory and nothing else. It depends only on the
standard library, and in particular never imports `store`; the caller supplies
the set of referenced ids. That keeps `store` about notes and makes `attach`
testable against a temp directory with no database in sight.

```go
package attach

type Ref struct {
    ID   string // 16 hex characters of the SHA-256 of the contents
    Name string // the original filename, for the link text
    Ext  string // derived from the sniffed content type
    Size int64
    MIME string
}

func Open(dir string) (*Store, error)

// Add copies the bytes in and returns the reference. Adding the same bytes
// twice returns the same id and writes nothing the second time. Anything over
// MaxSize is refused before it is written.
func (s *Store) Add(name string, r io.Reader) (Ref, error)

// Refs reports the attachment ids a note's markdown references. Pure: no I/O,
// no database. This is the only place that knows the reference format, so the
// writers and the reader cannot disagree about it.
func Refs(markdown string) []string

// Markdown renders a reference for insertion into a note: the image form for
// images, the link form for everything else.
func (r Ref) Markdown() string

// Open reads an attachment by id. It rejects any id that is not exactly the
// expected shape, so no caller can reach outside the directory.
func (s *Store) Open(id string) (io.ReadSeekCloser, error)

// Sweep reconciles the directory against the ids the notes actually use.
func (s *Store) Sweep(referenced map[string]struct{}) (moved, restored int, err error)

// PurgeExpired deletes trashed files older than d.
func (s *Store) PurgeExpired(d time.Duration) (int, error)
```

**Location.** `filepath.Join(filepath.Dir(dbPath), "attachments")`. Deriving it
from the database path rather than from the home directory means `--db`
pointing elsewhere takes the attachments with it, and the relative links in the
note text keep resolving.

**Writing.** Bytes go to `attachments/.tmp/<random>`, are fsynced, then renamed
into place. A process killed mid-write leaves no half-file. If the destination
already exists the bytes are already stored, the temp file is discarded, and the
existing id is returned — that is the whole of deduplication.

**Extensions** come from the sniffed content type, not the supplied filename, so
the same bytes always produce the same path.

### No schema change

This is the most useful consequence of "inline in the note". There is no
`attachments` table, no foreign key, no join, and no migration. A note's
attachments are exactly the ids its markdown references. Every hard case —
delete, undo, restore from trash, edit in an external editor, edit from the web
UI while the TUI is open — becomes the same reconciliation, rather than
bookkeeping that can drift out of sync with the text.

### Lifecycle

The caller builds the referenced set by running `attach.Refs` over the body of
every note, deleted ones included, and hands it to `Sweep`, which moves files in
both directions:

- live but unreferenced → `.trash/`
- in `.trash/` but referenced again → back to live

The second direction is what makes undo and note-restore work without a line of
special-case code.

**Trashed notes count as references.** A note in the trash is recoverable for 30
days, so its attachments must be too; otherwise restoring it returns a note full
of broken images. The referenced set is gathered from all notes, deleted ones
included.

`PurgeExpired` then removes files whose mtime in `.trash/` is older than
`store.TrashRetention`.

**When it runs:** at startup, beside the existing `purgeExpiredTrash()` call in
`store.Open`, and on demand via a new `nib gc`. Not on save — it is a full scan
of note bodies, which is cheap once per launch and wrong per keystroke.

### Web

- `POST /api/attachments` — multipart upload, returns `{id, name, markdown}`.
- `GET /attachments/<id>` — serves the bytes. Content-addressed files are
  immutable, so a strong ETag and `Cache-Control: immutable`. `Content-Type`
  from the stored MIME; `Content-Disposition: inline` for images, `attachment`
  otherwise.

The id is validated against `^[0-9a-f]{16}\.[a-z0-9]+$` before it is used to
build a path. User-supplied text is never joined into a filename.

Because the page is served from `/`, a relative `attachments/x.png` in the
rendered markdown resolves to that route with no rewriting. Confirm DOMPurify's
configuration in `client/src/lib/markdown.js` permits `img` with relative `src`.

`Editor.jsx` gets `drop` and `paste` handlers sharing one upload function,
inserting at the cursor and showing a placeholder while the bytes upload.

### TUI

In edit mode, a `KeyMsg` with `Paste: true` whose content resolves to one or
more existing files becomes an import; anything else is an ordinary paste, and a
path that does not exist falls through to being pasted as text.

Normalising a dropped path covers: the `file://` scheme, percent-encoding,
surrounding single or double quotes, backslash-escaped spaces, a leading `~`,
and several paths in a single drop separated by whitespace or newlines.

In the preview an attachment renders as a chip — `[img screenshot.png 240 KB]` —
and joins the list `o` opens, resolving to the absolute path and launching the
system viewer through the existing opener in `internal/tui/model.go`.

## What this breaks

Both follow directly from putting bytes on disk, and both are in scope.

**`nib snapshot` stops being a backup.** It dumps SQL, which will not contain
the images. It becomes `nib-<timestamp>.tar.gz` holding `notes.sql` and
`attachments/`. This is a breaking change to a documented command and must be
called out in the release notes.

**The one-file promise needs rewording.** The README, the site's custody
section, and `--help` all say the notes are a single SQLite file. They become a
directory: the database, and the attachments beside it.

## Testing

Hermetic throughout: temp directories, no network, no real terminal, no real
clipboard.

- `attach`: deduplication returns the same id and writes once; an interrupted
  write leaves no partial file; ids outside the expected shape are rejected,
  including `../` and absolute paths; the size cap rejects at the boundary;
  sweep moves files both directions; purge deletes only what is old enough.
- `store`: the referenced set includes soft-deleted notes.
- `web`: upload round-trips; serving returns the right content type and ETag; a
  malformed id is refused without touching the filesystem.
- `tui`: a synthetic paste message holding a real temp file path imports it; a
  paste of ordinary text does not; a `file://` URI works; several paths in one
  paste all import; a nonexistent path is pasted as text.

## Delivery

Four pull requests. One would be unreviewable.

- **A** — `internal/attach` and its tests. No user-visible change.
- **B** — web upload and serve, plus drop and paste in the client.
- **C** — TUI paste-to-import, preview chips, `o` to open.
- **D** — snapshot tarball, README, site, docs.

## Deliberately out of scope

- Drawing images inline in terminals that support it.
- Reading images from the clipboard in the TUI.
- Resizing, recompressing, or thumbnailing.
- Syncing attachments anywhere.
