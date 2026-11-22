# Images as chips, and copying prompts with images

## Why

nib is used to write prompts that are then copied and pasted into Claude Code.
Prompts often include screenshots. Two problems:

- In the note, each image is a full-width picture that breaks up the text.
- Copied out, an image was `![](attachments/x.jpg)`, a path only nib understands,
  so Claude Code never got the picture.

## What we learned from a test (2026-11-22)

Copying each image as its full file path works: Claude Code turns a pasted
image path into `[Image #N]`. But it moves every image to the start of the
message, ahead of the text, in the order they appeared. So the text has to say
where each image belongs.

## Goals

1. **Chips.** Every attached image shows as a small chip inside the line: a tiny
   thumbnail and "Image 1", "Image 2", numbered in the order they appear in the
   note.
2. **Expand in place (option A).** Clicking a chip shows the full image right
   there, as images look today (resize and caption still work). A collapse button
   turns it back into a chip. Each image remembers which way it was left, per
   browser, the way image sizes already are (`lib/mediaSize.js`).
3. **Paste and drop put a chip at the cursor**, inside the line, instead of
   starting a new full-width block.
4. **Copying text** writes a label and the full path where each image was:
   `Fix the bug in (image 1) /home/…/attachments/b441.jpg here`. After Claude
   Code takes the paths, the text still reads "(image 1)", matching the chip's
   name in nib. An image box that never got a file is left out.
5. **Copying one image on its own** (only that chip selected) also puts the
   picture itself on the clipboard, so Ctrl+V in Claude Code attaches it directly.
   Browsers only accept PNG on the clipboard, so other formats are converted.
6. **A Copy button** in the note's header copies the whole note the way
   goal 4 describes, and says "Copied".
7. **Fix `&#x20;`.** A line that ends in a space is saved as `…&#x20;`, and that
   code shows up in titles, the sidebar and copied text. Drop trailing spaces
   on save instead.

## Not doing

- Changing how notes are stored. Images stay `![](attachments/…)`, so the
  terminal and existing notes keep working.
- Sending images anywhere, or putting several pictures on the clipboard at once
  (a clipboard holds one).

## Approaches considered

- **Chips: expand in place (chosen)** or open a viewer on top. The viewer was
  simpler but hides the text while looking at the image.
- **Copy: full path (chosen)**, the picture itself, or both. Only one picture fits
  on a clipboard and a terminal pastes text, so paths are the only way to carry
  several images. The picture is added only when a single image is copied.

## Already built (test, branch feat/image-chips)

- `/api/health` reports the absolute attachments folder.
- `client/src/lib/milkdown/copyPaths.js` swaps attached images for full paths in
  copied plain text. The HTML copy keeps the image, so pasting back into nib still
  works. Goal 4's labels are still to be added.

## Left to the builder

- How the chip is drawn: an inline node view for the existing `image` node,
  and a collapsed look for `image-block`, so both kinds become chips.
- Where the expanded/collapsed state is stored, following `mediaSize.js`.
- Numbering updates as images are added, moved or removed.
