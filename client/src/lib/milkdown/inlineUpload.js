import { editorViewOptionsCtx } from '@milkdown/kit/core';
import { uploadConfig } from '@milkdown/kit/plugin/upload';
import { toast } from 'sonner';

// A pasted or dropped picture used to arrive as a full-width block, splitting
// the sentence it was pasted into. A prompt reads "fix this [screenshot] so it
// matches that [screenshot]", so the picture belongs in the line, where the
// chip for it is drawn (see imageChips.js).
//
// Crepe's own uploader makes block images; this one replaces it with inline
// ones. It has to be set after Crepe's - createEditor's config runs later, so
// it is.

export function inlineUploader(onUpload) {
  return async (files, schema) => {
    const nodes = [];
    for (let i = 0; i < files.length; i++) {
      const file = files.item(i);
      if (!file || !file.type.startsWith('image/')) continue;
      try {
        const src = await onUpload(file);
        nodes.push(schema.nodes.image.create({ src, alt: '', title: '' }));
      } catch (e) {
        toast.error('Could not add the image', { description: e?.message });
      }
    }
    return nodes;
  };
}

export function inlineUpload(ctx, onUpload) {
  ctx.update(uploadConfig.key, (prev) => ({
    ...prev,
    uploader: inlineUploader(onUpload),
    // A browser's "Copy image", Slack and many screenshot tools put HTML on
    // the clipboard beside the picture itself. Left off, that HTML won and the
    // paste became a link to someone else's copy, or nothing at all. The file
    // is what was meant. A copy with no file - text from nib or a web page -
    // still pastes as before.
    enableHtmlFileUploader: true,
  }));
  // Milkdown's clipboard plugin takes every paste with HTML in it before the
  // upload plugin is asked, so a picture copied with HTML beside it never got
  // uploaded - in a to-do, a list, a table, anywhere. The editor's own props
  // are asked before any plugin's, so a paste holding an image file is handed
  // to the upload plugin here, first.
  ctx.update(editorViewOptionsCtx, (prev) => ({
    ...prev,
    handlePaste: (view, event, slice) => {
      if (hasImageFile(event.clipboardData)) {
        const upload = view.state.plugins.find((plugin) => plugin.key.startsWith('MILKDOWN_UPLOAD'));
        if (upload?.props.handlePaste?.call(upload, view, event, slice)) return true;
      }
      return prev.handlePaste?.(view, event, slice) ?? false;
    },
  }));
}

function hasImageFile(data) {
  const files = data?.files;
  if (!files) return false;
  for (let i = 0; i < files.length; i++) {
    if (files.item ? files.item(i)?.type.startsWith('image/') : files[i]?.type.startsWith('image/')) return true;
  }
  return false;
}
