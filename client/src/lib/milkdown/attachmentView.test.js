import { describe, expect, it } from 'vitest';
import { renderAttachment } from './attachmentView';

// One box per kind, built from the same kindOf mapping the read view used, so
// a file that played in the note before still plays in the note now.
const box = (src, text) => renderAttachment({ src, text });

describe('what each kind draws', () => {
  it('a video plays in the note', () => {
    const el = box('attachments/1111111111111111.mp4', 'demo.mp4');
    const video = el.querySelector('video');
    expect(video).not.toBeNull();
    expect(video.getAttribute('src')).toBe('/attachments/1111111111111111.mp4');
    expect(video.hasAttribute('controls')).toBe(true);
    // Enough to draw a timeline without pulling the file down to skim a note.
    expect(video.getAttribute('preload')).toBe('metadata');
  });

  it('audio plays in the note', () => {
    const el = box('attachments/2222222222222222.m4a', 'take-3.m4a');
    expect(el.querySelector('audio')).not.toBeNull();
    expect(el.querySelector('video')).toBeNull();
  });

  it('a player carries the name it was given', () => {
    // A player on its own is anonymous, so without this the nearest link above
    // it reads as its label and every name lines up against the wrong file.
    const el = box('attachments/3333333333333333.mp4', 'demo.mp4');
    expect(el.textContent).toContain('demo.mp4');
  });

  it('a docx opens in the viewer tab', () => {
    const el = box('attachments/4444444444444444.docx', 'brief.docx');
    const a = el.querySelector('a[href]');
    expect(a.getAttribute('href')).toBe('/view/4444444444444444.docx?name=brief.docx');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('a csv opens in the viewer tab', () => {
    const el = box('attachments/5555555555555555.csv', 'rows.csv');
    expect(el.querySelector('a').getAttribute('href')).toContain('/view/5555555555555555.csv');
  });

  it('a pdf keeps its raw href, for the browser viewer', () => {
    const el = box('attachments/6666666666666666.pdf', 'notes.pdf');
    const a = el.querySelector('a[href]');
    expect(a.getAttribute('href')).toBe('/attachments/6666666666666666.pdf');
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it('a container no browser decodes says so and offers the file', () => {
    const el = box('attachments/7777777777777777.mkv', 'raw.mkv');
    expect(el.querySelector('video')).toBeNull();
    const a = el.querySelector('a[href]');
    expect(a.getAttribute('href')).toContain('7777777777777777.mkv');
  });

  it('anything else downloads, as it did before', () => {
    const el = box('attachments/8888888888888888.zip', 'bundle.zip');
    const a = el.querySelector('a[href]');
    expect(a.getAttribute('href')).toBe('/attachments/8888888888888888.zip');
    expect(a.getAttribute('download')).toBe('bundle.zip');
    expect(a.getAttribute('target')).toBeNull();
  });
});

describe('the box itself', () => {
  it('is inline, so a link mid-sentence does not break the paragraph', () => {
    expect(box('attachments/9999999999999999.pdf', 'a.pdf').tagName).toBe('SPAN');
  });

  it('says which file it is, for the resize code to key on', () => {
    const el = box('attachments/aaaaaaaaaaaaaaaa.mp4', 'a.mp4');
    expect(el.dataset.file).toBe('aaaaaaaaaaaaaaaa.mp4');
  });

  it('falls back to the stored name when the link had no text', () => {
    const el = box('attachments/bbbbbbbbbbbbbbbb.pdf', '');
    expect(el.textContent).toContain('bbbbbbbbbbbbbbbb.pdf');
  });
});

describe('resizing a video', () => {
  const widthOf = (el) => el.querySelector('.nib-sizable').style.width;

  const drag = (box, from, to) => {
    const grip = box.querySelector('.nib-grip');
    const media = box.querySelector('.nib-sizable');
    // A real browser reports the width it was just given; a constant here
    // would mean the drag stored the width it started from.
    media.getBoundingClientRect = () => ({
      width: media.style.width ? Number.parseFloat(media.style.width) : 400,
    });
    // The article is what the media has to fit inside.
    const article = document.createElement('div');
    Object.defineProperty(article, 'clientWidth', { value: 900 });
    article.append(box);

    grip.dispatchEvent(new PointerEvent('pointerdown', { clientX: from, bubbles: true }));
    grip.dispatchEvent(new PointerEvent('pointermove', { clientX: to, bubbles: true }));
    grip.dispatchEvent(new PointerEvent('pointerup', { clientX: to, bubbles: true }));
  };

  it('gives a video a grip, and audio none', () => {
    expect(box('attachments/1111111111111111.mp4', 'a.mp4').querySelector('.nib-grip')).not.toBeNull();
    // An audio player is a row of controls at a fixed height; dragging it
    // wider would do nothing useful.
    expect(box('attachments/2222222222222222.m4a', 'a.m4a').querySelector('.nib-grip')).toBeNull();
  });

  it('a drag sets a width and remembers it', () => {
    localStorage.clear();
    const el = box('attachments/3333333333333333.mp4', 'a.mp4');
    drag(el, 100, 200);
    expect(widthOf(el)).toBe('500px');
    // Reopening the same file picks the width back up.
    expect(box('attachments/3333333333333333.mp4', 'a.mp4').querySelector('.nib-sizable').style.width)
      .toBe('500px');
  });

  it('a double click puts it back', () => {
    localStorage.clear();
    const el = box('attachments/4444444444444444.mp4', 'a.mp4');
    drag(el, 100, 200);
    expect(widthOf(el)).toBe('500px');
    el.querySelector('.nib-grip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(widthOf(el)).toBe('');
    expect(box('attachments/4444444444444444.mp4', 'a.mp4').querySelector('.nib-sizable').style.width).toBe('');
  });
});
