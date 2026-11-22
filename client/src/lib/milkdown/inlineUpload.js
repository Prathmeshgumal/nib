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
  ctx.update(uploadConfig.key, (prev) => ({ ...prev, uploader: inlineUploader(onUpload) }));
}
