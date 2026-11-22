import { editorViewOptionsCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core';
import { NodeSelection } from '@milkdown/kit/prose/state';
import { storedName } from '@/lib/attachments';
import { attachedImages } from './imageChips';
import { tidyEscapes } from './tidyEscapes';

// Copying a prompt out of nib for Claude Code. In the note an image is
// `![](attachments/x.jpg)`, a path that means nothing outside nib.
//
// Claude Code attaches a pasted image path - but only when the path is alone
// on its line (it splits each line at every space before a `/`, and keeps the
// line as text unless every piece is a path). It also moves the pictures to
// the front of the message. So each image becomes "(image N)" where it stood,
// matching its chip in nib, and the paths follow at the end, one per line, in
// the same order: the text reads as written and every picture arrives.
//
// Only the plain text changes. The HTML copy keeps the image, so pasting back
// into a note still gives a picture.

let attachmentsDir = null;

export function setAttachmentsDir(dir) {
  attachmentsDir = typeof dir === 'string' && dir ? dir.replace(/\/+$/, '') : null;
}

// Alt text can hold escaped brackets - the terminal writes a file's original
// name there - and only real stored names count, the same ones chips are drawn
// for, so the numbers here and on the chips cannot drift apart.
const IMAGE =
  /!\[(?:\\.|[^\]\\])*\]\(<?attachments\/([0-9a-f]{16}\.[a-z0-9]{1,8})>?(?:\s+"(?:[^"\\]|\\.)*")?\)/g;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

// A table is padded so its columns line up in the note, sized for the image
// markdown in it. In a copy the images are shorter labels, and the padding
// leaves gaps, so each row is tightened: one space around each cell, and a
// plain `---` under the header (keeping any `:` that sets alignment).
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const DELIMITER_ROW = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;

function tightRow(line) {
  if (DELIMITER_ROW.test(line)) return line.trim().replace(/\s*(:?)-+(:?)\s*(?=\|)/g, ' $1---$2 ');
  return line.trim().replace(/ {2,}/g, ' ');
}

// Markdown's ways of keeping something the eye cannot see, turned back into
// what they stand for. `&#x20;` keeps a space at either end of a line: in a
// copy it is just a space, and at the ends of a line not even that. A line
// break inside a paragraph is a backslash at the end of the line: in a copy it
// is just the line break. An even run of backslashes is literal text, kept.
function plainLines(markdown) {
  let fence = null;
  return markdown
    .split('\n')
    .map((line) => {
      const open = FENCE.exec(line);
      if (open) {
        if (fence === null) fence = open[1][0];
        else if (fence === open[1][0]) fence = null;
        return line;
      }
      if (fence !== null) return line;
      if (TABLE_ROW.test(line)) return tightRow(line);
      const trailing = /\\+$/.exec(line)?.[0].length ?? 0;
      if (trailing % 2 === 1) line = line.slice(0, -1).trimEnd();
      return line
        .replace(/^(?:&#x20;)+/, '')
        .replace(/(?:&#x20;)+$/, '')
        .replaceAll('&#x20;', ' ');
    })
    .join('\n');
}

// firstNumber is the note-wide number of the first image in `markdown`, so a
// copy of part of a note still calls its images what their chips say.
export function withImagePaths(markdown, dir = attachmentsDir, firstNumber = 1) {
  if (!dir) return markdown;
  const paths = [];
  let n = firstNumber;
  const text = plainLines(
    markdown
      .replace(IMAGE, (_, stored) => {
        paths.push(`${dir}/${stored}`);
        return `(image ${n++})`;
      })
      .replace(/!\[\]\(\)\n*/g, ''),
  );
  if (paths.length === 0) return text;
  return `${text.trimEnd()}\n\n${paths.join('\n')}`;
}

function hasLineBreak(fragment) {
  let found = false;
  fragment.descendants((node) => {
    if (node.type.name === 'hardbreak' || node.type.name === 'hard_break') found = true;
    return !found;
  });
  return found;
}

function hasAttachedImage(fragment) {
  let found = false;
  fragment.descendants((node) => {
    if (found) return false;
    if (storedName(node.attrs?.src)) found = true;
    return !found;
  });
  return found;
}

// How many attached images come before the selection, so the first one in it
// gets the number its chip shows.
function imagesBefore(state) {
  const from = state.selection.from;
  return attachedImages(state.doc).filter((image) => image.pos < from).length;
}

// The selection when it is exactly one attached image, with its number.
function soleImage(state) {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return null;
  const name = storedName(selection.node.attrs?.src);
  if (!name) return null;
  const image = attachedImages(state.doc).find((found) => found.pos === selection.from);
  return image ?? null;
}

// Browsers only take PNG on the clipboard, so whatever the picture is stored
// as is drawn onto a canvas and read back as PNG.
function pngBlob(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no png'))), 'image/png');
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('image did not load'));
    img.src = src;
  });
}

// One image copied on its own goes on the clipboard as the picture itself, so
// Ctrl+V in Claude Code attaches it with no path involved. Its label and path
// go in the same copy as text, and are written straight away too, so a browser
// that refuses the picture still leaves something useful on the clipboard.
function copyPicture(view, event) {
  const image = attachmentsDir && soleImage(view.state);
  if (!image) return false;
  const text = `${attachmentsDir}/${image.name}`;
  if (event.clipboardData) event.clipboardData.setData('text/plain', text);
  event.preventDefault();

  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    const picture = pngBlob(image.node.attrs.src);
    // The clipboard reads the promise; this only keeps a failure from being
    // reported as unhandled when it does not.
    picture.catch(() => {});
    navigator.clipboard
      .write([
        new ClipboardItem({
          'image/png': picture,
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
      .catch(() => {});
  }
  return true;
}

export function copyPaths(ctx) {
  ctx.update(editorViewOptionsCtx, (prev) => ({
    ...prev,
    handleDOMEvents: {
      ...prev.handleDOMEvents,
      copy: (view, event) => copyPicture(view, event) || prev.handleDOMEvents?.copy?.(view, event) || false,
    },
    // Asked before Milkdown's own clipboard plugin. A copy with no attached
    // image is handed back to it (null), which copies plain text as plain text.
    clipboardTextSerializer: (slice, view) => {
      const images = attachmentsDir && hasAttachedImage(slice.content);
      // Milkdown writes a line break as a trailing backslash, so a copy with
      // one is written here even without images.
      if (!images && !hasLineBreak(slice.content)) return null;
      const doc = ctx.get(schemaCtx).topNodeType.createAndFill(undefined, slice.content);
      if (!doc) return '';
      const markdown = tidyEscapes(ctx.get(serializerCtx)(doc));
      if (!images) return plainLines(markdown).trimEnd();
      const first = view ? imagesBefore(view.state) + 1 : 1;
      return withImagePaths(markdown, attachmentsDir, first).trimEnd();
    },
  }));
}
