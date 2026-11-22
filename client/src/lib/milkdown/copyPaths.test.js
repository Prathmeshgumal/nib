import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorViewCtx } from '@milkdown/kit/core';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { createEditor } from './editorConfig';
import { setAttachmentsDir, withImagePaths } from './copyPaths';

const DIR = '/home/someone/.local/share/nib/attachments';

describe('copied text points at the image files', () => {
  it('swaps each attached image for a numbered label and its full path', () => {
    const md = 'Fix the bug in ![](attachments/b441.jpg "the caption") and ![x](attachments/c2.png).';
    expect(withImagePaths(md, DIR)).toBe(
      `Fix the bug in (image 1) ${DIR}/b441.jpg and (image 2) ${DIR}/c2.png.`,
    );
  });

  it('numbers from where the copy starts in the note', () => {
    expect(withImagePaths('see ![](attachments/x.png)', DIR, 3)).toBe(`see (image 3) ${DIR}/x.png`);
  });

  it('leaves images on the web, links and text alone', () => {
    const md = '![](https://example.com/a.png) [attachments/x.png](attachments/x.png) plain';
    expect(withImagePaths(md, DIR)).toBe(md);
  });

  it('drops an image box that never got a file', () => {
    expect(withImagePaths('after\n\n![]()\n\nmore', DIR)).toBe('after\n\nmore');
  });

  it('changes nothing until the folder is known', () => {
    const md = '![](attachments/b441.jpg)';
    expect(withImagePaths(md, null)).toBe(md);
  });
});

describe('copying out of the editor', () => {
  let crepe;
  let root;
  afterEach(async () => {
    await crepe?.destroy();
    root?.remove();
    setAttachmentsDir(null);
  });

  async function open(markdown) {
    root = document.createElement('div');
    document.body.appendChild(root);
    crepe = createEditor(root, { markdown });
    await crepe.create();
    return crepe.editor.action((ctx) => ctx.get(editorViewCtx));
  }

  function copied(view) {
    const slice = view.state.selection.content();
    let text;
    view.someProp('clipboardTextSerializer', (f) => (text = f(slice, view)));
    return text;
  }

  async function copyAll(markdown) {
    const view = await open(markdown);
    const slice = view.state.doc.slice(0, view.state.doc.content.size);
    let text;
    view.someProp('clipboardTextSerializer', (f) => (text = f(slice, view)));
    return text;
  }

  it('writes the full path where the image was', async () => {
    setAttachmentsDir(DIR);
    const text = await copyAll('Look at this\n\n![](attachments/b441.jpg)\n\nand fix it\n');
    expect(text).toContain(`${DIR}/b441.jpg`);
    expect(text).not.toContain('](attachments/');
    expect(text).toContain('Look at this');
    expect(text).toContain('and fix it');
  });

  it('leaves text with no images to the editor as before', async () => {
    setAttachmentsDir(DIR);
    expect(await copyAll('just_some text\n')).toBe('just_some text');
  });

  it('keeps the note-wide number when copying part of a note', async () => {
    setAttachmentsDir(DIR);
    const view = await open('![](attachments/0123456789abcdef.png)\n\nsecond ![](attachments/fedcba9876543210.png) here\n');
    let start = 0;
    view.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent.startsWith('second')) start = pos + 1;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, view.state.doc.content.size - 1)));
    const text = copied(view);
    expect(text).toContain(`(image 2) ${DIR}/fedcba9876543210.png`);
    expect(text).not.toContain('(image 1)');
  });

  it('puts the picture itself on the clipboard when one image is copied alone', async () => {
    setAttachmentsDir(DIR);
    const write = vi.fn(async () => {});
    vi.stubGlobal('ClipboardItem', class { constructor(items) { this.items = items; } });
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText: vi.fn() }, configurable: true });

    const view = await open('Look ![](attachments/0123456789abcdef.png) here\n');
    let at = -1;
    view.state.doc.descendants((node, pos) => { if (node.type.name === 'image') at = pos; });
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
    const event = new Event('copy', { bubbles: true, cancelable: true });
    view.dom.dispatchEvent(event);

    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0][0][0];
    expect(Object.keys(item.items).sort()).toEqual(['image/png', 'text/plain']);
    expect(event.defaultPrevented).toBe(true);
    vi.unstubAllGlobals();
  });

  it('copies text with an image the normal way', async () => {
    setAttachmentsDir(DIR);
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText: vi.fn() }, configurable: true });
    const view = await open('Look ![](attachments/0123456789abcdef.png) here\n');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)));
    view.dom.dispatchEvent(new Event('copy', { bubbles: true, cancelable: true }));
    expect(write).not.toHaveBeenCalled();
  });
});
