import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import { toast } from 'sonner';
import { createEditor } from './editorConfig';
import { inlineUploader } from './inlineUpload';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const files = (...list) => ({ length: list.length, item: (i) => list[i] ?? null });
const png = () => new File(['x'], 'shot.png', { type: 'image/png' });
const text = () => new File(['x'], 'notes.txt', { type: 'text/plain' });

let crepe;
let root;

async function open(markdown, onUpload = async () => 'attachments/0123456789abcdef.png') {
  root = document.createElement('div');
  document.body.appendChild(root);
  crepe = createEditor(root, { markdown, onUpload });
  await crepe.create();
  return crepe.editor.action((ctx) => [ctx.get(editorViewCtx), ctx.get(schemaCtx)]);
}

afterEach(async () => {
  await crepe?.destroy();
  root?.remove();
  crepe = null;
  vi.clearAllMocks();
});

describe('a pasted image goes into the line', () => {
  it('makes an inline image for each image file and skips the rest', async () => {
    const [, schema] = await open('Hello\n');
    const nodes = await inlineUploader(async () => 'attachments/0123456789abcdef.png')(files(png(), text()), schema);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type.name).toBe('image');
    expect(nodes[0].attrs.src).toBe('attachments/0123456789abcdef.png');
  });

  it('says so when an upload fails and leaves nothing behind', async () => {
    const [, schema] = await open('Hello\n');
    const nodes = await inlineUploader(async () => {
      throw new Error('disk full');
    })(files(png()), schema);
    expect(nodes).toEqual([]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).toBe('Could not add the image');
  });

  it('is what the editor uses, landing inside the sentence', async () => {
    const [view, schema] = await open('Hello world\n');
    const nodes = await crepe.editor.action(async (ctx) => {
      const { uploadConfig } = await import('@milkdown/kit/plugin/upload');
      return ctx.get(uploadConfig.key).uploader(files(png()), schema, ctx, 0);
    });
    const at = 1 + 'Hello'.length;
    view.dispatch(view.state.tr.insert(at, nodes[0]));
    expect(crepe.getMarkdown()).toBe('Hello![](attachments/0123456789abcdef.png) world\n');
  });
});
