import { afterEach, describe, expect, it } from 'vitest';
import { editorViewCtx } from '@milkdown/kit/core';
import { undoDepth } from '@milkdown/kit/prose/history';
import { createEditor } from './editorConfig';
import { attachedImages } from './imageChips';
import { isExpanded } from '../expandedImages';

let crepe;
let root;

async function open(markdown) {
  root = document.createElement('div');
  document.body.appendChild(root);
  crepe = createEditor(root, { markdown });
  await crepe.create();
  return crepe.editor.action((ctx) => ctx.get(editorViewCtx));
}

const press = (el) => el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));

afterEach(async () => {
  await crepe?.destroy();
  root?.remove();
  crepe = null;
  localStorage.clear();
});

describe('numbering the images in a note', () => {
  it('counts only attached images, in order', async () => {
    const view = await open('One ![](attachments/0123456789abcdef.png) two\n\n![](https://x.com/b.png)\n\n![](attachments/fedcba9876543210.jpg)\n');
    const found = attachedImages(view.state.doc);
    expect(found.map((f) => f.name)).toEqual(['0123456789abcdef.png', 'fedcba9876543210.jpg']);
    expect(found.map((f) => f.number)).toEqual([1, 2]);
  });

  it('gives the same picture twice two numbers', async () => {
    const view = await open('![](attachments/0123456789abcdef.png) and ![](attachments/0123456789abcdef.png)\n');
    const found = attachedImages(view.state.doc);
    expect(found.map((f) => [f.name, f.number])).toEqual([['0123456789abcdef.png', 1], ['0123456789abcdef.png', 2]]);
  });
});

describe('an image is a chip until opened', () => {
  it('draws a numbered chip and hides the picture', async () => {
    await open('See ![](attachments/0123456789abcdef.png) and\n\n![](attachments/fedcba9876543210.jpg)\n');
    const chips = [...root.querySelectorAll('.nib-image-chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['Image 1', 'Image 2']);
    expect(root.querySelectorAll('.nib-image-collapsed').length).toBe(2);
  });

  it('opens in place without editing the note, and closes again', async () => {
    const view = await open('See ![](attachments/0123456789abcdef.png) here\n');
    const before = crepe.getMarkdown();
    const depth = undoDepth(view.state);

    press(root.querySelector('.nib-image-chip'));
    expect(isExpanded('0123456789abcdef.png')).toBe(true);
    expect(root.querySelector('.nib-image-collapsed')).toBeNull();
    expect(root.querySelector('.nib-image-collapse')).not.toBeNull();
    expect(crepe.getMarkdown()).toBe(before);
    expect(undoDepth(view.state)).toBe(depth);

    press(root.querySelector('.nib-image-collapse'));
    expect(isExpanded('0123456789abcdef.png')).toBe(false);
    expect(root.querySelectorAll('.nib-image-collapsed').length).toBe(1);
  });
});
