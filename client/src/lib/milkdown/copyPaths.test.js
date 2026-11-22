import { afterEach, describe, expect, it } from 'vitest';
import { editorViewCtx } from '@milkdown/kit/core';
import { createEditor } from './editorConfig';
import { setAttachmentsDir, withImagePaths } from './copyPaths';

const DIR = '/home/someone/.local/share/nib/attachments';

describe('copied text points at the image files', () => {
  it('swaps each attached image for its full path', () => {
    const md = 'Fix the bug in ![](attachments/b441.jpg "the caption") and ![x](attachments/c2.png).';
    expect(withImagePaths(md, DIR)).toBe(`Fix the bug in ${DIR}/b441.jpg and ${DIR}/c2.png.`);
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

  async function copyAll(markdown) {
    root = document.createElement('div');
    document.body.appendChild(root);
    crepe = createEditor(root, { markdown });
    await crepe.create();
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
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
});
