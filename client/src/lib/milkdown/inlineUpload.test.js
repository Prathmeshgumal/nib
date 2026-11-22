import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import { toast } from 'sonner';
import { createEditor } from './editorConfig';
import { inlineUploader } from './inlineUpload';

// jsdom has no ClipboardEvent, and the upload plugin only acts on one.
if (typeof globalThis.ClipboardEvent === 'undefined') {
  globalThis.ClipboardEvent = class ClipboardEvent extends Event {};
}
if (typeof globalThis.DragEvent === 'undefined') {
  globalThis.DragEvent = class DragEvent extends Event {};
}

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

  // A browser's "Copy image", Slack and many screenshot tools put HTML on the
  // clipboard beside the file. The file is what was meant.
  for (const [where, markdown, word] of [
    ['a to-do', '- [ ] todo item\n', 'todo item'],
    ['a bullet', '- bullet item\n', 'bullet item'],
    ['a numbered item', '1. numbered item\n', 'numbered item'],
    ['a heading', '## Heading item\n', 'Heading item'],
    ['a quote', '> quote item\n', 'quote item'],
    ['a table cell', '| a | b |\n| - | - |\n| cell item | x |\n', 'cell item'],
    ['a paragraph', 'Paragraph item\n', 'Paragraph item'],
  ]) {
    it(`uploads an image pasted with HTML beside it into ${where}`, async () => {
      const [view] = await open(markdown);
      const { TextSelection } = await import('@milkdown/kit/prose/state');
      let end = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === word) end = pos + node.nodeSize;
      });
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));

      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      const data = { 'text/html': '<img src="https://example.com/x.png">' };
      Object.defineProperty(event, 'clipboardData', {
        value: { files: files(png()), getData: (type) => data[type] ?? '', types: ['Files', 'text/html'], items: [] },
      });
      view.dom.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 100));

      const line = crepe.getMarkdown().split('\n').find((l) => l.includes(word));
      expect(line).toContain(`${word}![](attachments/0123456789abcdef.png)`);
      expect(crepe.getMarkdown()).not.toContain('example.com');
    });
  }

  it('pastes HTML with no file in it the normal way', async () => {
    const onUpload = vi.fn(async () => 'attachments/0123456789abcdef.png');
    const [view] = await open('- [ ] todo item\n', onUpload);
    const { TextSelection } = await import('@milkdown/kit/prose/state');
    let end = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'todo item') end = pos + node.nodeSize;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    const data = { 'text/html': '<b>bold words</b>', 'text/plain': 'bold words' };
    Object.defineProperty(event, 'clipboardData', {
      value: { files: files(), getData: (type) => data[type] ?? '', types: ['text/html', 'text/plain'], items: [] },
    });
    view.dom.dispatchEvent(event);
    await new Promise((r) => setTimeout(r, 50));
    expect(crepe.getMarkdown()).toContain('todo item**bold words**');
    expect(onUpload).not.toHaveBeenCalled();
  });
});
