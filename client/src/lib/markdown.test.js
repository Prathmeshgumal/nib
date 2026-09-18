import { expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

const parse = (html) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
};

it('stamps each rendered block with where it starts in the source', () => {
  const src = '# Title\n\nA paragraph.\n\n- one\n  - nested\n';
  const host = parse(renderMarkdown(src));
  const stamped = [...host.querySelectorAll('[data-src]')].map((el) => [
    el.tagName,
    src.slice(Number(el.getAttribute('data-src'))).split('\n')[0],
  ]);
  expect(stamped).toEqual([
    ['H1', '# Title'],
    ['P', 'A paragraph.'],
    ['LI', '- one'],
    ['LI', '  - nested'],
  ]);
});

it('still strips dangerous markup', () => {
  expect(renderMarkdown('<img src=x onerror=alert(1)>')).not.toContain('onerror');
});

it('renders an empty note without throwing', () => {
  expect(renderMarkdown('')).toBe('');
});

it('leaves task checkboxes clickable, so a box can be ticked while reading', () => {
  const src = '- [ ] milk\n- [x] eggs\n';
  const host = parse(renderMarkdown(src));
  const boxes = [...host.querySelectorAll('input[type="checkbox"]')];
  expect(boxes).toHaveLength(2);
  // marked renders these disabled, which would swallow the click.
  expect(boxes.some((b) => b.hasAttribute('disabled'))).toBe(false);
  expect(boxes[0].checked).toBe(false);
  expect(boxes[1].checked).toBe(true);
  // Each one sits inside a stamped item, which is how the click finds its line.
  expect(boxes.map((b) => b.closest('[data-src]').getAttribute('data-src')))
    .toEqual([String(src.indexOf('- [ ] milk')), String(src.indexOf('- [x] eggs'))]);
});

// Attachments: the note stores a plain link for everything that is not an
// image, and the page decides what that link should become.
const ID = '54d071396a02facc';

it('plays a video where it sits, instead of linking to it', () => {
  const host = parse(renderMarkdown(`[clip.mp4](attachments/${ID}.mp4)`));
  const video = host.querySelector('video');
  expect(video).not.toBe(null);
  expect(video.getAttribute('src')).toBe(`/attachments/${ID}.mp4`);
  expect(video.hasAttribute('controls')).toBe(true);
  expect(host.querySelector('a')).toBe(null);
});

it('plays audio where it sits too', () => {
  const host = parse(renderMarkdown(`[song.mp3](attachments/${ID}.mp3)`));
  expect(host.querySelector('audio').getAttribute('src'))
    .toBe(`/attachments/${ID}.mp3`);
});

it('sends a document to the viewer tab', () => {
  const link = parse(renderMarkdown(`[report.docx](attachments/${ID}.docx)`))
    .querySelector('a');
  // the readable filename travels with it, so the tab has a title
  expect(link.getAttribute('href')).toBe(`/view/${ID}.docx?name=report.docx`);
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
});

it('leaves a PDF pointing at the file, for the browser to open', () => {
  const link = parse(renderMarkdown(`[paper.pdf](attachments/${ID}.pdf)`))
    .querySelector('a');
  expect(link.getAttribute('href')).toBe(`attachments/${ID}.pdf`);
  expect(link.getAttribute('target')).toBe('_blank');
});

it('leaves a file it can show nothing for exactly as it was', () => {
  const link = parse(renderMarkdown(`[deck.pptx](attachments/${ID}.pptx)`))
    .querySelector('a');
  expect(link.getAttribute('href')).toBe(`attachments/${ID}.pptx`);
  expect(link.hasAttribute('target')).toBe(false);
});

it('does not touch an ordinary link in the prose', () => {
  const link = parse(renderMarkdown('[home](https://example.test/a.mp4)'))
    .querySelector('a');
  expect(link.getAttribute('href')).toBe('https://example.test/a.mp4');
  expect(parse(renderMarkdown('[home](https://example.test/a.mp4)')).querySelector('video'))
    .toBe(null);
});

it('keeps the source offsets intact when a player replaces a link', () => {
  const src = `# Title\n\nbefore\n\n[clip.mp4](attachments/${ID}.mp4)\n`;
  const host = parse(renderMarkdown(src));
  const stamped = [...host.querySelectorAll('[data-src]')].map((el) =>
    src.slice(Number(el.getAttribute('data-src'))).split('\n')[0]);
  expect(stamped).toEqual(['# Title', 'before', `[clip.mp4](attachments/${ID}.mp4)`]);
  // and the player is inside the block that still carries its offset
  expect(host.querySelector('video').closest('[data-src]')).not.toBe(null);
});
