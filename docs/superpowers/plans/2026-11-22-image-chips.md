# Image Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attached images show as numbered chips in the line that expand in place, and copying a note gives Claude Code the images plus "(image N)" labels where they were.

**Architecture:** Chips are drawn the way `imageResize.js` draws its grip: ProseMirror decorations over Milkdown's own `image` and `image-block` nodes. Nothing in the document or the markdown changes. Copy goes through the view-level `clipboardTextSerializer` that `copyPaths.js` already installs, ahead of Milkdown's clipboard plugin. Pasted files go through Crepe's `uploadConfig` uploader, overridden to make inline `image` nodes.

**Tech Stack:** React 18, Milkdown Crepe 7.22 / ProseMirror, Vitest + jsdom, Go 1.x for the store.

**Spec:** `docs/superpowers/specs/2026-11-22-image-chips-design.md`

## Global Constraints

- The saved markdown for an image stays `![alt](attachments/<file> "caption")`. No new syntax, no attribute that reaches the markdown.
- Only images whose `src` starts with `attachments/` become chips or get paths. Images from the web are left exactly as they are.
- Chip label text: `Image N`, numbered 1, 2, 3… by position in the whole note, counting every attached image occurrence.
- Copy label text: `(image N) ` followed by the absolute path, with N the same number the chip shows.
- Expanded state is per browser, in localStorage, keyed `nib.expanded.<stored file name>`, wrapped in try/catch like `lib/mediaSize.js`. Default: collapsed.
- Copy button copy: "Copy" → "Copied" for 1.6s, the same timing as `flashCopied` in `chromeExtras.js`.
- Commit messages: one line, at most 10 words, plain words, no attribution trailer.

## Review Focus

1. **The same picture twice in a note.** Each occurrence is its own chip with its own number, and copy labels count occurrences the same way. Both expand together, because state is keyed by file. Test in Task 1 and Task 3.
2. **Copying part of a note.** The labels keep the note-wide numbers (copying only the second image's line gives `(image 2)`, not `(image 1)`). Test in Task 3.
3. **Undo after expanding or collapsing.** Toggling is a view change, not an edit: it must not add an undo step or mark the note "Editing". Test in Task 1 (the toggle transaction sets `addToHistory: false` and changes no document).
4. **A pasted image that fails to upload.** No empty chip is left behind and the paste raises nib's existing "Save failed"-style toast. Test in Task 2.
5. **`&#x20;` inside a code block.** A code line that really ends in `&#x20;` is kept. Test in Task 4.

---

### Task 1: Chips that expand in place

**Files:**
- Create: `client/src/lib/milkdown/imageChips.js`
- Create: `client/src/lib/expandedImages.js`
- Modify: `client/src/lib/milkdown/editorConfig.js` (`.use(imageChips)` after `imageResize`)
- Modify: `client/src/lib/milkdown/crepe.css` (chip styles, collapsed hiding)
- Test: `client/src/lib/milkdown/imageChips.test.js`, `client/src/lib/expandedImages.test.js`

**Interfaces:**
- Produces: `isExpanded(name: string): boolean`, `setExpanded(name: string, open: boolean): void` in `expandedImages.js`
- Produces: `attachedImages(doc: Node): Array<{ pos: number, node: Node, name: string, number: number }>` in `imageChips.js`. `name` comes from `storedName(src)` in `lib/attachments.js`; `number` starts at 1 in document order. Task 3 uses this for numbering.
- Produces: `imageChips` (a `$prose` plugin) and `imageChipsKey: PluginKey`

- [ ] **Step 1: Write the failing tests**

`expandedImages.test.js`: `isExpanded('a.png')` is false by default. After `setExpanded('a.png', true)` it is true. After `setExpanded('a.png', false)` the key `nib.expanded.a.png` is removed. A throwing `localStorage` makes `isExpanded` return false without throwing.

`imageChips.test.js`, using `createEditor` as `taskToggle.test.js` does:
- `attachedImages` on `'One ![](attachments/a.png) two\n\n![](https://x.com/b.png)\n\n![](attachments/c.jpg)\n'` returns names `['a.png','c.jpg']` with numbers `[1,2]`.
- The same file twice gives numbers `[1,2]`, both with name `a.png`.
- After `create()`, the editor root has two `.nib-image-chip` elements with text `Image 1` and `Image 2`. Each image node's DOM has class `nib-image-collapsed`.
- Clicking the first chip: its node loses `nib-image-collapsed` and gains a `.nib-image-collapse` button; `isExpanded('a.png')` is true. `crepe.getMarkdown()` is unchanged, and `undoDepth(view.state)` (from `@milkdown/kit/prose/history`) is unchanged.
- Clicking `.nib-image-collapse` collapses it again.

- [ ] **Step 2: Run them to see them fail**

Run: `cd client && npx vitest run src/lib/expandedImages.test.js src/lib/milkdown/imageChips.test.js`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `expandedImages.js`**

Same shape as `mediaSize.js`. Prefix `nib.expanded.`, value `'1'`.

- [ ] **Step 4: Implement `imageChips.js`**

The plugin's `decorations(state)` walks `attachedImages(state.doc)`. For each image:
- collapsed: `Decoration.node(pos, pos+size, { class: 'nib-image-collapsed' })`, plus a widget at `pos` (side -1) that draws the chip.
- expanded: a widget that draws the collapse button.

The chip is a `<button type="button" class="nib-image-chip" contenteditable="false">` holding `<img class="nib-image-chip-thumb" src=…>` and `<span>Image N</span>`, with `aria-label="Image N, show full image"`. The collapse button is `<button class="nib-image-collapse" aria-label="Collapse to a chip">`. Use a lucide-style SVG; `Minimize2` is fine.

Clicking either one calls `setExpanded`, then dispatches `state.tr.setMeta(imageChipsKey, 'redraw').setMeta('addToHistory', false)` so the decorations recompute. Handle the click on `pointerdown` with `preventDefault`, so the editor selection does not jump. Widget `key`s must include name, number and state, so ProseMirror redraws a widget when its number changes.

- [ ] **Step 5: Styles in `crepe.css`**

- `.nib-image-collapsed` hides the picture (`img`, the resize grip, the caption, the operation buttons) and takes no block space.
- `.nib-image-chip` is an inline-flex pill: 22px tall, 1px `var(--border)`, `var(--muted)` background, radius 6px, 12px text, a 16px thumbnail with `object-fit: cover` and 3px radius, `vertical-align: middle`.
- For a collapsed `image-block`, the chip sits on its own line.
- `.nib-image-collapse` sits at the image's top-right corner, 28px, popover background with border.
- Both buttons get the existing focus ring.

- [ ] **Step 6: Run the tests and see them pass**

Run: `cd client && npx vitest run`
Expected: all pass. `roundTrip.test.js` must be unchanged, which proves the markdown never sees the chips.

- [ ] **Step 7: Commit**

`git commit -m "Show images as chips that open in place"`

---

### Task 2: Pasted and dropped images land as chips in the line

**Files:**
- Create: `client/src/lib/milkdown/inlineUpload.js`
- Modify: `client/src/lib/milkdown/editorConfig.js` (call `inlineUpload(ctx, onUpload)` in the same `.config` that sets stringify options, only when `onUpload` is given)
- Test: `client/src/lib/milkdown/inlineUpload.test.js`

**Interfaces:**
- Consumes: `onUpload(file: File): Promise<string>` from `MilkdownEditor.jsx` (returns `attachments/<stored>`)
- Produces: `inlineUploader(onUpload)` returning the `uploader(files: FileList, schema) => Promise<Node[]>` that `uploadConfig` takes, and `inlineUpload(ctx, onUpload)`, which sets it with `ctx.update(uploadConfig.key, …)`

- [ ] **Step 1: Write the failing tests**

- `inlineUploader(async () => 'attachments/x.png')` given a FileList of one `image/png` file and one `text/plain` file returns one node, of type `image` (not `image-block`), with `attrs.src === 'attachments/x.png'`.
- When `onUpload` rejects, it returns `[]` and calls `toast.error` once with `'Could not add the image'`. Mock `sonner`.
- Integration: with an editor at `'Hello world\n'`, the cursor after "Hello", and nodes from the uploader inserted the way the upload plugin does (`tr.replaceSelectionWith(node)`), the markdown becomes `Hello![](attachments/x.png) world`. Same paragraph, no new block.

- [ ] **Step 2: Run them to see them fail**

Run: `cd client && npx vitest run src/lib/milkdown/inlineUpload.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `inlineUpload.js`**

Per image file: `schema.nodes.image.create({ src: await onUpload(file), alt: '', title: '' })`. Skip non-image files. On a failed upload, call `toast.error('Could not add the image', { description: e.message })` and skip that file. It must run after Crepe's own builder config, which `crepe.editor.config` in `createEditor` already does.

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd client && npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

`git commit -m "Paste images into the line as chips"`

---

### Task 3: Copying with "(image N)" labels, one image as a picture, and a Copy button

**Files:**
- Modify: `client/src/lib/milkdown/copyPaths.js`
- Modify: `client/src/components/MilkdownEditor.jsx` (add `copyNote()` to the object passed to `onReady`)
- Modify: `client/src/components/NotePane.jsx` (Copy button in the header, before the status)
- Modify: `client/src/App.jsx` (pass `onCopy={() => editor.current?.copyNote?.()}` to `NotePane`)
- Test: `client/src/lib/milkdown/copyPaths.test.js`

**Interfaces:**
- Consumes: `attachedImages(doc)` from Task 1
- Produces: `withImagePaths(markdown: string, dir?: string, firstNumber = 1): string`. It now writes `(image N) <dir>/<file>` and numbers from `firstNumber` in order of appearance.
- Produces: `copyNote(): Promise<boolean>` on the editor API. It writes the whole note through the same serializer to `navigator.clipboard.writeText` and resolves `false` if that fails.
- Produces: `NotePane` prop `onCopy: () => Promise<boolean>`

- [ ] **Step 1: Update and add the failing tests**

- `withImagePaths('a ![](attachments/x.png) b ![](attachments/y.jpg)', DIR)` → `` `a (image 1) ${DIR}/x.png b (image 2) ${DIR}/y.jpg` ``
- With `firstNumber` 3, the first label is `(image 3)`.
- In the editor test, copying a selection that starts after the first image of `'![](attachments/a.png)\n\nsecond ![](attachments/b.png)\n'` gives text containing `(image 2)` and not `(image 1)`. The serializer reads `firstNumber` from the selection: 1 + the count of `attachedImages(view.state.doc)` whose `pos < view.state.selection.from`.
- Single picture: when the copied slice is exactly one attached image node, the `copy` DOM handler calls `navigator.clipboard.write` once with a `ClipboardItem` holding `'image/png'` and `'text/plain'`. Mock `navigator.clipboard.write` and `ClipboardItem`. For text plus an image, `write` is not called.

- [ ] **Step 2: Run them to see them fail**

Run: `cd client && npx vitest run src/lib/milkdown/copyPaths.test.js`
Expected: FAIL on the label and numbering assertions.

- [ ] **Step 3: Implement the labels and numbering in `copyPaths.js`**

The serializer receives `(slice, view)`. Compute `firstNumber` as described in Step 1.

- [ ] **Step 4: Implement single-image copy**

Add `editorViewOptionsCtx.handleDOMEvents.copy`, merged with any existing handlers, which only acts when the selection is a `NodeSelection` on an attached image. Call `navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(src), 'text/plain': new Blob([text]) })])`, passing `pngBlob` as a Promise so the user gesture is kept. `pngBlob` loads the image, draws it on a canvas and calls `toBlob('image/png')`.

Then `event.preventDefault()` and return true. On any failure, fall back to the normal copy by returning false before calling `preventDefault`. Clicking a chip must still make a NodeSelection on its image: the chip's `pointerdown` handles expanding, and the image node is selected by an arrow key or by clicking the chip's border area. If that is unreliable, select the node in the chip's click handler when Shift is held. Report which one you did.

- [ ] **Step 5: Copy button**

- In `NotePane.jsx`, add a ghost `Button` with `size="sm"`, the lucide `Copy` icon and the text "Copy", `title="Copy the whole note, with images as files"`.
- After `onCopy()` resolves `true`, show `Check` and "Copied" for 1600ms. On `false`, show "Couldn't copy".
- Hide the text below `sm` and keep the icon, with an `aria-label`.

- [ ] **Step 6: Run all tests and see them pass**

Run: `cd client && npx vitest run`
Expected: all pass.

- [ ] **Step 7: Commit**

`git commit -m "Label copied images and add a copy button"`

---

### Task 4: Stop saving trailing spaces as `&#x20;`

**Files:**
- Modify: `client/src/lib/milkdown/tidyEscapes.js` (new exported `dropTrailingSpaceRefs(markdown)`, called first inside `tidyEscapes`)
- Modify: `client/src/lib/noteText.js` (`deriveTitle` strips a trailing `&#x20;` from the line it picks)
- Modify: `internal/store/store.go` (`DeriveTitle` does the same)
- Test: `client/src/lib/milkdown/tidyEscapes.test.js`, `client/src/lib/noteText.test.js`, `internal/store/store_test.go`

**Interfaces:**
- Produces: `dropTrailingSpaceRefs(markdown: string): string`

- [ ] **Step 1: Write the failing tests**

- `dropTrailingSpaceRefs('first image&#x20;\nnext')` → `'first image\nnext'`
- A run like `'a&#x20;&#x20;'` → `'a'`
- Lines inside a ```` ``` ```` or `~~~` fence are kept as they are: `` '```\ncode&#x20;\n```' `` is unchanged.
- `&#x20;` in the middle of a line is kept.
- `deriveTitle('', 'This is a test&#x20;\n')` → `'This is a test'`. Same for Go: `DeriveTitle("", "This&#x20;\nmore")` → `"This"`, added as a case in `TestDeriveTitle`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd client && npx vitest run src/lib/milkdown/tidyEscapes.test.js src/lib/noteText.test.js && cd .. && go test ./internal/store/ -run TestDeriveTitle`
Expected: FAIL.

- [ ] **Step 3: Implement**

`tidyEscapes` currently returns early when there is no backslash. Call `dropTrailingSpaceRefs` before that check. The regex is `(?:&#x20;)+$` per line, outside fences.

- [ ] **Step 4: Run every test**

Run: `cd client && npx vitest run && cd .. && go test ./...`
Expected: all pass.

- [ ] **Step 5: Commit**

`git commit -m "Stop saving trailing spaces as a code"`

---

### Task 5: Check it in the real app

**Files:** none changed unless a check fails.

- [ ] **Step 1: Build:** `./build.sh`. Expected: `Built ./nib`.
- [ ] **Step 2: Run on a scratch database** with `./nib --web --port 4322 --db <scratch>/check.db`. Then, in a browser:
  - Paste two images into a sentence → two chips, "Image 1" and "Image 2".
  - Expand one → full image with a collapse button. Reload → it is still expanded.
  - Undo does not undo the expand.
  - Ctrl+A, Ctrl+C → text with `(image 1) /abs/…` and `(image 2) /abs/…`.
  - The Copy button gives the same text and shows "Copied".
  - Dark mode and 390px width look right.
- [ ] **Step 3: Tell the user to run `~/Desktop/worked_projects/nib/nib --web`** and paste into Claude Code. Don't open the PR until asked.
