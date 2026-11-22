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

  it('selects the image instead with Shift, ready to copy on its own', async () => {
    const view = await open('See ![](attachments/0123456789abcdef.png) here\n');
    root.querySelector('.nib-image-chip').dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, shiftKey: true }),
    );
    expect(isExpanded('0123456789abcdef.png')).toBe(false);
    expect(view.state.selection.node?.type.name).toBe('image');
  });

  it('shows when its image is selected, so typing over it is no surprise', async () => {
    const view = await open('See ![](attachments/0123456789abcdef.png) here\n');
    const { NodeSelection } = await import('@milkdown/kit/prose/state');
    let at = -1;
    view.state.doc.descendants((node, pos) => { if (node.type.name === 'image') at = pos; });
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
    expect(root.querySelector('.nib-image-chip').classList.contains('nib-image-chip-selected')).toBe(true);
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at).constructor.near(view.state.doc.resolve(1))));
    expect(root.querySelector('.nib-image-chip').classList.contains('nib-image-chip-selected')).toBe(false);
  });

  it('opens both copies of a picture used twice', async () => {
    await open('![](attachments/0123456789abcdef.png) and ![](attachments/0123456789abcdef.png)\n');
    press(root.querySelector('.nib-image-chip'));
    expect(root.querySelectorAll('.nib-image-chip').length).toBe(0);
    expect(root.querySelectorAll('.nib-image-collapse').length).toBe(2);
  });

  it('looks selected when a text selection covers its image', async () => {
    const view = await open('See ![](attachments/0123456789abcdef.png) here\n\nafter\n');
    const { TextSelection } = await import('@milkdown/kit/prose/state');
    const chip = () => root.querySelector('.nib-image-chip');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)));
    expect(chip().classList.contains('nib-image-chip-selected')).toBe(true);
    // A selection that stops before the image leaves it alone.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    expect(chip().classList.contains('nib-image-chip-selected')).toBe(false);
  });

  it('leaves the editor focused after opening or closing, so Ctrl+A selects the note', async () => {
    const view = await open('See ![](attachments/0123456789abcdef.png) here\n');
    press(root.querySelector('.nib-image-chip'));
    expect(document.activeElement).toBe(view.dom);
    view.dom.blur();
    press(root.querySelector('.nib-image-collapse'));
    expect(document.activeElement).toBe(view.dom);
  });

  it('draws no resize grip for a collapsed image, so the cursor after it has somewhere to stand', async () => {
    await open('See ![](attachments/0123456789abcdef.png)\n');
    expect(root.querySelectorAll('.nib-grip').length).toBe(0);
    press(root.querySelector('.nib-image-chip'));
    expect(root.querySelectorAll('.nib-grip').length).toBe(1);
  });
});
