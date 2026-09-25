import { beforeEach, describe, expect, it } from 'vitest';
import { createEditor } from './editorConfig';

async function mount(markdown) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const crepe = createEditor(root, { markdown });
  await crepe.create();
  return root;
}

beforeEach(() => localStorage.clear());

describe('images can be resized, the way they could before', () => {
  it('an attachment image gets a grip', async () => {
    const root = await mount('![diagram](attachments/a1b2c3d4e5f60718.png)\n');
    expect(root.querySelector('.nib-grip')).not.toBeNull();
  });

  it('a picture from elsewhere on the web does not', async () => {
    // Its width is nothing we can key on, and it is not ours to size.
    const root = await mount('![x](https://example.com/a.png)\n');
    expect(root.querySelector('.nib-grip')).toBeNull();
  });

  it('an inline attachment image gets one too', async () => {
    const root = await mount('Inline ![x](attachments/1111111111111111.png) here.\n');
    expect(root.querySelector('.nib-grip')).not.toBeNull();
  });

  it('the box says which file it is', async () => {
    const root = await mount('![d](attachments/2222222222222222.png)\n');
    expect(root.querySelector('[data-nib-file="2222222222222222.png"]')).not.toBeNull();
  });

  it('a width chosen earlier is put back', async () => {
    localStorage.setItem('nib.size.3333333333333333.png', '420');
    const root = await mount('![d](attachments/3333333333333333.png)\n');
    const sized = root.querySelector('[data-nib-file="3333333333333333.png"]');
    expect(sized.getAttribute('style') || '').toContain('420px');
  });
});

describe('resizing an image never reaches the note', () => {
  it('leaves the markdown byte-identical', async () => {
    const md = '![diagram](attachments/4444444444444444.png)\n';
    const root = document.createElement('div');
    document.body.appendChild(root);
    const crepe = createEditor(root, { markdown: md });
    await crepe.create();

    const grip = root.querySelector('.nib-grip');
    const img = root.querySelector('img');
    img.getBoundingClientRect = () => ({
      width: img.style.width ? Number.parseFloat(img.style.width) : 300,
    });

    grip.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, bubbles: true }));
    grip.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, bubbles: true }));
    grip.dispatchEvent(new PointerEvent('pointerup', { clientX: 150, bubbles: true }));

    // The width was chosen and remembered...
    expect(localStorage.getItem('nib.size.4444444444444444.png')).toBe('450');
    // ...and the note is exactly what it was. This is the whole reason the
    // grip is a decoration rather than a node attribute.
    expect(crepe.getMarkdown()).toBe(md);
  });
});
