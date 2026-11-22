import { editorViewOptionsCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core';
import { NodeSelection } from '@milkdown/kit/prose/state';
import { storedName } from '@/lib/attachments';
import { attachedImages } from './imageChips';
import { tidyEscapes } from './tidyEscapes';

// Copying a prompt out of nib for Claude Code. In the note an image is
// `![](attachments/x.jpg)`, a path that means nothing outside nib. Claude Code
// turns a pasted absolute image path into an attached image - but it moves
// every image to the front of the message and removes the path. So each image
// is copied as "(image N)" and its full path: the path brings the picture, and
// the label stays where the image was, matching the chip's name in nib.
//
// Only the plain text changes. The HTML copy keeps the image itself, so
// pasting back into a note still gives a picture.

let attachmentsDir = null;

export function setAttachmentsDir(dir) {
  attachmentsDir = typeof dir === 'string' && dir ? dir.replace(/\/+$/, '') : null;
}

const IMAGE = /!\[[^\]]*\]\((?:<)?(attachments\/[^\s)>]+)(?:>)?(?:\s+"(?:[^"\\]|\\.)*")?\)/g;

const pathOf = (dir, ref) => `${dir}/${ref.slice('attachments/'.length)}`;

// firstNumber is the note-wide number of the first image in `markdown`, so a
// copy of part of a note still calls its images what their chips say.
export function withImagePaths(markdown, dir = attachmentsDir, firstNumber = 1) {
  if (!dir) return markdown;
  let n = firstNumber;
  return markdown
    .replace(IMAGE, (_, ref) => `(image ${n++}) ${pathOf(dir, ref)}`)
    .replace(/!\[\]\(\)\n*/g, '');
}

function hasAttachedImage(fragment) {
  let found = false;
  fragment.descendants((node) => {
    if (found) return false;
    if (typeof node.attrs?.src === 'string' && node.attrs.src.startsWith('attachments/')) found = true;
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
  const text = `(image ${image.number}) ${pathOf(attachmentsDir, image.node.attrs.src)}`;
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
    // Asked before Milkdown's own clipboard plugin. The text is tidied the way
    // a saved note is, so a copy never carries `&#x20;` or stray backslashes.
    clipboardTextSerializer: (slice, view) => {
      const doc = ctx.get(schemaCtx).topNodeType.createAndFill(undefined, slice.content);
      if (!doc) return '';
      const markdown = tidyEscapes(ctx.get(serializerCtx)(doc));
      if (!attachmentsDir || !hasAttachedImage(slice.content)) return markdown.trimEnd();
      const first = view ? imagesBefore(view.state) + 1 : 1;
      return withImagePaths(markdown, attachmentsDir, first).trimEnd();
    },
  }));
}
