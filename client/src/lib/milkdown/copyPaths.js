import { editorViewOptionsCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core';

// Copying a note out is mostly for pasting it somewhere else - a prompt into
// Claude Code, more often than not. In the note an image is
// `![caption](attachments/b441….jpg)`, a path that only means something to
// nib. In the copied text each one becomes the file's full path on this
// machine instead, which is what a terminal tool can open: Claude Code turns a
// pasted image path into an attached image, the same as a dropped file.
//
// Only the plain text changes. The HTML that goes along with it still carries
// the image, so pasting back into nib brings the image back, not a path.

let attachmentsDir = null;

// Where the server keeps attachments, from /api/health. Until it is known,
// copied text keeps nib's own relative links.
export function setAttachmentsDir(dir) {
  attachmentsDir = typeof dir === 'string' && dir ? dir.replace(/\/+$/, '') : null;
}

const IMAGE = /!\[[^\]]*\]\((?:<)?(attachments\/[^\s)>]+)(?:>)?(?:\s+"(?:[^"\\]|\\.)*")?\)/g;

// The markdown with each attached image swapped for its full path. Anything
// else - images on the web, links, text - is left exactly as it was.
export function withImagePaths(markdown, dir = attachmentsDir) {
  if (!dir) return markdown;
  return markdown
    .replace(IMAGE, (_, ref) => `${dir}/${ref.slice('attachments/'.length)}`)
    // An image box still waiting for a file has nothing to send.
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

// Runs ahead of Milkdown's own clipboard plugin, which writes the selection as
// markdown: the view's own props are asked before any plugin's.
export function copyPaths(ctx) {
  ctx.update(editorViewOptionsCtx, (prev) => ({
    ...prev,
    clipboardTextSerializer: (slice) => {
      // Nothing to swap: let Milkdown's own serializer answer, so plain text
      // copies exactly as it always has. A falsy answer passes it on.
      if (!attachmentsDir || !hasAttachedImage(slice.content)) return null;
      const schema = ctx.get(schemaCtx);
      const doc = schema.topNodeType.createAndFill(undefined, slice.content);
      if (!doc) return '';
      return withImagePaths(ctx.get(serializerCtx)(doc)).trimEnd();
    },
  }));
}
