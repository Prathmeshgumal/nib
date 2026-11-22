import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorViewCtx } from '@milkdown/kit/core';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { createEditor } from './editorConfig';
import { setAttachmentsDir, withImagePaths } from './copyPaths';

const DIR = '/home/someone/.local/share/nib/attachments';

const A = '0123456789abcdef.png';
const B = 'fedcba9876543210.jpg';

describe('copied text points at the image files', () => {
  it('labels each image in the text and lists the paths at the end, one per line', () => {
    const md = `Fix the bug in ![](attachments/${A} "the caption") and ![x](attachments/${B}).`;
    expect(withImagePaths(md, DIR)).toBe(
      `Fix the bug in (image 1) and (image 2).\n\n${DIR}/${A}\n${DIR}/${B}`,
    );
  });

  it('numbers from where the copy starts in the note', () => {
    expect(withImagePaths(`see ![](attachments/${A})`, DIR, 3)).toBe(`see (image 3)\n\n${DIR}/${A}`);
  });

  it('lists a picture used twice twice, so the numbers still line up', () => {
    expect(withImagePaths(`![](attachments/${A}) ![](attachments/${A})`, DIR)).toBe(
      `(image 1) (image 2)\n\n${DIR}/${A}\n${DIR}/${A}`,
    );
  });

  it('reads an image whose name has brackets in it', () => {
    const md = `![shot \\[1\\].png](attachments/${A}) then ![](attachments/${B})`;
    expect(withImagePaths(md, DIR)).toBe(`(image 1) then (image 2)\n\n${DIR}/${A}\n${DIR}/${B}`);
  });

  it('keeps a backslash that is really part of the text', () => {
    expect(withImagePaths(`C:\\\\ ![](attachments/${A}) end \\\\\nnext`, DIR)).toBe(`C:\\\\ (image 1) end \\\\\nnext\n\n${DIR}/${A}`);
  });

  it('tightens a table whose padding was sized for the image markdown', () => {
    const md = [
      '| a                                       | b |',
      '| --------------------------------------- | - |',
      `| cell ![](attachments/${A}) item | x |`,
    ].join('\n');
    expect(withImagePaths(md, DIR)).toBe(`| a | b |\n| --- | --- |\n| cell (image 1) item | x |\n\n${DIR}/${A}`);
  });

  it('turns a space code back into a space', () => {
    expect(withImagePaths(`&#x20;see ![](attachments/${A})&#x20;`, DIR)).toBe(`see (image 1)\n\n${DIR}/${A}`);
  });

  it('leaves images on the web, odd attachment names, links and text alone', () => {
    const md = '![](https://example.com/a.png) ![](attachments/notahash.png) [attachments/x.png](attachments/x.png) plain';
    expect(withImagePaths(md, DIR)).toBe(md);
  });

  it('drops an image box that never got a file', () => {
    expect(withImagePaths('after\n\n![]()\n\nmore', DIR)).toBe('after\n\nmore');
  });

  it('changes nothing until the folder is known', () => {
    const md = `![](attachments/${A})`;
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
    const text = await copyAll(`Look at this\n\n![](attachments/${A})\n\nand fix it\n`);
    expect(text).toContain(`\n${DIR}/${A}`);
    expect(text).not.toContain('](attachments/');
    expect(text).toContain('Look at this');
    expect(text).toContain('and fix it');
  });

  it('copies a line that ends in a space without the space code', async () => {
    setAttachmentsDir(DIR);
    expect(await copyAll(`Here is the image&#x20;\n\n![](attachments/${A})\n`)).not.toContain('&#x20;');
  });

  it('copies a line break as a plain line break, not a backslash', async () => {
    setAttachmentsDir(DIR);
    const md = `first line\\\nsecond ![](attachments/${A}) line\\\nthird\n`;
    const text = await copyAll(md);
    expect(text).toContain('first line\nsecond (image 1) line\nthird');
    expect(await copyAll('no image\\\nnext line\n')).toBe('no image\nnext line');
  });

  it('leaves text with no images to the editor as before', async () => {
    setAttachmentsDir(DIR);
    expect(await copyAll('just_some text\n')).toBe('just_some text');
    expect(await copyAll('use <div> here\n')).not.toContain('\\<');
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
    expect(text).toContain('(image 2)');
    expect(text).toContain(`${DIR}/fedcba9876543210.png`);
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
