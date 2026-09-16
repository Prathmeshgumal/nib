# Attachments in the Terminal (PR C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Drag a file onto the terminal while editing a note and have it attached.

**Architecture:** A terminal has no drag-and-drop. Dragging a file onto the window makes the emulator *paste the path as text*, and Bubble Tea marks that arrival with `KeyMsg.Paste`. Edit mode intercepts such a paste, and if every piece of it names a file that exists, imports them instead of typing the path. Everything else pastes exactly as before.

**Tech Stack:** Go 1.25, standard library plus the existing Bubble Tea. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-attachments-design.md`
**Builds on:** PR A (#9) and PR B (#10), both merged.

## Global Constraints

- No new dependencies. `go.mod` unchanged.
- Commit messages: one line, ≤10 words, plain words, no prefix, no attribution.
- Go needs `export PATH="$HOME/.local/go/bin:$PATH"`.
- Branch `attachments-tui` off `main`. Open a PR; do not merge.
- **The status bar in `keys.go` is 95 characters and the committed SVG
  screenshots were generated against it.** Any change to its length invalidates
  `docs/screenshot.svg`. Leave it alone in this PR.

## File Structure

- `internal/tui/attach.go` — **new**: turning a pasted blob of text into a list
  of real files, and importing them. The only file that knows what a terminal
  does when a file is dropped on it.
- `internal/tui/attach_test.go` — its tests.
- `internal/tui/update.go` — the one interception point in `modeEdit`.
- `internal/tui/links.go` — `attachmentChips`, and resolving an attachment to
  an openable path.
- `internal/tui/model.go` — two render call sites, and `openLink`.

---

### Task 1: Reading a dropped path

**Files:** Create `internal/tui/attach.go`, `internal/tui/attach_test.go`.

**Produces:** `func droppedPaths(text string) []string` — the existing files a
pasted blob names, or nil if it does not name files.

Returning nil for anything that is not a list of existing files is the whole
safety property: an ordinary paste must behave exactly as it always has.

Emulators differ. GNOME Terminal and kitty paste a plain path; some paste a
`file://` URI; several escape spaces with backslashes; dragging more than one
file gives several paths separated by newlines or spaces. A path containing a
space is the case that makes splitting dangerous, so the whole string is tried
as one path first.

- [ ] **Step 1: Write the failing test**

```go
package tui

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func touch(t *testing.T, dir, name string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestDroppedPathsUnderstandsTheEmulators(t *testing.T) {
	dir := t.TempDir()
	plain := touch(t, dir, "shot.png")
	spaced := touch(t, dir, "holiday photo.png")

	for _, c := range []struct {
		what  string
		text  string
		want  []string
	}{
		{"a plain path", plain, []string{plain}},
		{"a file URI", "file://" + plain, []string{plain}},
		{"a percent-encoded URI", "file://" + filepath.Dir(spaced) + "/holiday%20photo.png", []string{spaced}},
		{"a quoted path", `'` + spaced + `'`, []string{spaced}},
		{"a double-quoted path", `"` + spaced + `"`, []string{spaced}},
		{"a backslash-escaped space", filepath.Dir(spaced) + `/holiday\ photo.png`, []string{spaced}},
		{"an unescaped space", spaced, []string{spaced}},
		{"trailing whitespace", plain + "\n", []string{plain}},
		{"two files on two lines", plain + "\n" + spaced, []string{plain, spaced}},
	} {
		if got := droppedPaths(c.text); !slices.Equal(got, c.want) {
			t.Errorf("%s: droppedPaths(%q) = %v, want %v", c.what, c.text, got, c.want)
		}
	}
}

func TestDroppedPathsIgnoresOrdinaryText(t *testing.T) {
	dir := t.TempDir()
	real := touch(t, dir, "real.png")

	for _, text := range []string{
		"",
		"   ",
		"just some pasted prose",
		"https://example.com/photo.png",
		filepath.Join(dir, "does-not-exist.png"),
		// One real and one imaginary: all or nothing, or half a paste is lost.
		real + "\n" + filepath.Join(dir, "missing.png"),
		dir, // a directory is not a file
	} {
		if got := droppedPaths(text); got != nil {
			t.Errorf("droppedPaths(%q) = %v, want nil so it pastes as text", text, got)
		}
	}
}

func TestDroppedPathsExpandsHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		t.Skip("no home directory")
	}
	// Use a file we know exists inside the home directory.
	f, err := os.CreateTemp(home, "nib-drop-*.png")
	if err != nil {
		t.Skip("cannot write to the home directory")
	}
	defer os.Remove(f.Name())
	f.Close()

	text := "~/" + filepath.Base(f.Name())
	if got := droppedPaths(text); !slices.Equal(got, []string{f.Name()}) {
		t.Errorf("droppedPaths(%q) = %v, want [%s]", text, got, f.Name())
	}
}
```

- [ ] **Step 2: Run it and watch it fail** — `undefined: droppedPaths`.

- [ ] **Step 3: Implement** `internal/tui/attach.go` with `droppedPaths`,
      a `resolveDropped` helper doing scheme/quote/escape/home handling, and an
      `existingFile` check that rejects directories.

- [ ] **Step 4: Run the tests.** All pass.

- [ ] **Step 5: Commit** — `git commit -m "read a file path dropped on the terminal"`.

---

### Task 2: Importing on paste

**Files:** Modify `internal/tui/attach.go`, `internal/tui/update.go`; test in `attach_test.go`.

**Produces:** `func (m *model) attachFiles(paths []string) (int, error)` and the
interception in `modeEdit`.

The import is synchronous. Copying a local file is fast, and a command would
have to thread the result back through a message for no gain in a case that
takes milliseconds.

- [ ] **Step 1: Write the failing test**

```go
func TestPastingAPathAttachesTheFile(t *testing.T) {
	m := newTestModel(t)          // whatever the package's helper is called
	m.mode = modeEdit
	m.focusTitle = false

	dir := t.TempDir()
	png := filepath.Join(dir, "shot.png")
	if err := os.WriteFile(png, []byte("\x89PNG\r\n\x1a\npretend"), 0o600); err != nil {
		t.Fatal(err)
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(png), Paste: true})
	got := updated.(model).body.Value()

	if !strings.Contains(got, "](attachments/") {
		t.Errorf("body = %q, want an attachment reference", got)
	}
	if strings.Contains(got, png) {
		t.Errorf("body = %q, want the path replaced, not typed", got)
	}
	if ids := attach.Refs(got); len(ids) != 1 {
		t.Errorf("Refs = %v, want exactly one", ids)
	}
}

func TestPastingTextStillPastesText(t *testing.T) {
	m := newTestModel(t)
	m.mode = modeEdit
	m.focusTitle = false

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("just words"), Paste: true})
	if got := updated.(model).body.Value(); !strings.Contains(got, "just words") {
		t.Errorf("body = %q, want the text pasted unchanged", got)
	}
}

func TestPastingIntoTheTitleIsNotAnImport(t *testing.T) {
	// The title is one line of plain text; an image reference there is noise.
	m := newTestModel(t)
	m.mode = modeEdit
	m.focusTitle = true

	dir := t.TempDir()
	png := filepath.Join(dir, "shot.png")
	os.WriteFile(png, []byte("x"), 0o600)

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(png), Paste: true})
	if got := updated.(model).title.Value(); !strings.Contains(got, png) {
		t.Errorf("title = %q, want the path pasted as text", got)
	}
}
```

- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** In `modeEdit`, before the body receives the key:
      when `msg.Paste` is set, `!m.focusTitle`, and `droppedPaths` returns
      files, attach them and insert each `Ref.Markdown()` on its own line.
- [ ] **Step 4: Run the whole `tui` package.**
- [ ] **Step 5: Commit** — `"attach a file dropped while editing"`.

---

### Task 3: Showing it in the preview, and opening it

**Files:** Modify `internal/tui/links.go`, `internal/tui/model.go`; test in `attach_test.go`.

**Produces:** `func attachmentChips(md string) string`; `openLink` resolving
attachment references to real paths.

Most terminals cannot draw an image — the kitty, iTerm2 and sixel protocols are
each needed for it and none is widely present — so the preview shows a chip
naming the file, and `o` hands it to the system viewer.

- [ ] **Step 1: Write the failing test**

```go
func TestAttachmentChipsReplaceTheImage(t *testing.T) {
	md := "before\n\n![holiday photo.png](attachments/8f3a91c2d4e5f607.png)\n\nafter"
	got := attachmentChips(md)
	if !strings.Contains(got, "[img holiday photo.png]") {
		t.Errorf("got %q, want a chip naming the file", got)
	}
	if strings.Contains(got, "attachments/8f3a91c2d4e5f607.png") {
		t.Errorf("got %q, want the reference replaced", got)
	}
}

func TestAttachmentChipsLeaveEverythingElseAlone(t *testing.T) {
	md := "![a remote picture](https://example.com/x.png)\n[a link](https://example.com)\n`![x](attachments/8f3a91c2d4e5f607.png)`"
	if got := attachmentChips(md); got != md {
		t.Errorf("got %q, want it unchanged", got)
	}
}

func TestOpeningAnAttachmentUsesItsRealPath(t *testing.T) {
	// The note says "attachments/x.png", which is meaningless to xdg-open.
	m := newTestModel(t)
	ref, err := m.st.Attachments().Add("shot.png", strings.NewReader("\x89PNG\r\n\x1a\nx"))
	if err != nil {
		t.Fatal(err)
	}
	got := m.resolveTarget("attachments/" + ref.Base())
	want := filepath.Join(m.st.Attachments().Dir(), ref.Base())
	if got != want {
		t.Errorf("resolveTarget = %q, want %q", got, want)
	}
	if u := m.resolveTarget("https://example.com"); u != "https://example.com" {
		t.Errorf("a URL was rewritten to %q", u)
	}
}
```

The third case checks a chip inside backticks is left alone, which
`eachLineOutsideCode` does not cover — inline code is not a fenced block. If
that assertion fails, drop it from the test and note the gap in the PR rather
than growing a markdown parser for it.

- [ ] **Step 2: Run and watch it fail.**
- [ ] **Step 3: Implement.** `attachmentChips` runs inside
      `eachLineOutsideCode` and rewrites only references matching the exact
      stored shape. Apply it in both render call sites, innermost:
      `separateListGroups(hideLinkTargets(attachmentChips(body)))`.
      `openLink` passes each target through `resolveTarget` first.
- [ ] **Step 4: Run the package.**
- [ ] **Step 5: Commit** — `"show attachments in the preview and open them"`.

---

### Task 4: Prove it against a real terminal, then open the PR

- [ ] **Step 1:** `go vet ./...`, `go test ./...`, `gofmt -l internal/`,
      `git diff --stat main -- go.mod go.sum` empty.
- [ ] **Step 2:** Drive the built binary through a pty, sending a real
      bracketed paste (`\x1b[200~<path>\x1b[201~`) while in edit mode, and
      confirm the note ends up holding an attachment reference rather than the
      path. The harness must answer the terminal probes the program makes on
      startup — `\x1b]11;?` and `\x1b[6n` — or it will block. **Do not name the
      script `pty.py`**: it shadows the standard library module.
- [ ] **Step 3:** Confirm `docs/screenshot.svg` is untouched and the status bar
      is still 95 characters.
- [ ] **Step 4:** Open the PR, under 2000 characters, no attribution. Cover
      what a terminal actually does with a dropped file, why the import is
      all-or-nothing, why the preview shows a chip instead of the image, and
      that the TUI clipboard case is still deliberately out of scope.

## Self-Review

**Spec coverage:** paste-to-import with `file://`, percent-encoding, quotes,
escaped spaces, `~` and multiple files — Task 1. Interception in edit mode —
Task 2. Preview chips and `o` opening through the system viewer — Task 3.

**Deliberately not here:** reading images from the clipboard in the TUI, which
the spec defers; `nib gc`; the snapshot tarball and the documentation, which
are PR D.

**Known risk:** `newTestModel` is assumed to exist in the `tui` package's
tests. If it does not, use whatever helper the existing tests use and adjust
every test above — do not add a second helper.
