import { afterEach, describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';
import { setSize } from './mediaSize';

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
});

it('plays audio where it sits too', () => {
  const host = parse(renderMarkdown(`[song.mp3](attachments/${ID}.mp3)`));
  expect(host.querySelector('audio').getAttribute('src'))
    .toBe(`/attachments/${ID}.mp3`);
});

// A player with no name is anonymous, so the nearest link above it reads as
// its label - which is how every filename in a note ends up looking as though
// it belongs to the wrong file.
it('keeps the filename under the player', () => {
  const host = parse(renderMarkdown(`[holiday.mp4](attachments/${ID}.mp4)`));
  const caption = host.querySelector('.nib-caption');
  expect(caption.textContent).toBe('holiday.mp4');
  // and it is still how you get the file itself
  const save = caption.querySelector('a');
  expect(save.getAttribute('href')).toBe(`/attachments/${ID}.mp4`);
  expect(save.getAttribute('download')).toBe('holiday.mp4');
});

it('names every attachment, so no name can belong to its neighbour', () => {
  const src = [
    `[report.docx](attachments/${ID}.docx)`,
    `[clip.mov](attachments/aaaaaaaaaaaaaaaa.mov)`,
    `[paper.pdf](attachments/bbbbbbbbbbbbbbbb.pdf)`,
    `[song.mp3](attachments/cccccccccccccccc.mp3)`,
  ].join('\n\n');
  const host = parse(renderMarkdown(src));
  // every block carries its own name, in source order
  const named = [...host.querySelectorAll('a')].map((a) => a.textContent.trim());
  expect(named).toEqual(['report.docx', 'clip.mov', 'paper.pdf', 'song.mp3']);
  // and the two players are labelled by the name directly beneath them
  const players = [...host.querySelectorAll('.nib-media')];
  expect(players.map((p) => [p.firstElementChild.tagName, p.textContent.trim()]))
    .toEqual([['VIDEO', 'clip.mov'], ['AUDIO', 'song.mp3']]);
});

// The rendered string is handed to dangerouslySetInnerHTML, so it is parsed a
// second time. A <figure> inside the <p> a link sits in would be hoisted out
// of that paragraph on the second parse, taking its stamped offset with it.
it('survives being serialized and parsed again', () => {
  const src = `text\n\n[clip.mp4](attachments/${ID}.mp4)\n`;
  const once = renderMarkdown(src);
  const host = parse(once);
  expect(host.querySelectorAll('p')).toHaveLength(2);
  expect(host.querySelector('video').closest('p[data-src]')).not.toBe(null);
  // reparsing changed nothing, which is what stops the offsets drifting
  expect(host.innerHTML).toBe(once);
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

// Resizing. The width lives in browser storage, so the note is untouched and
// the terminal never sees any of this.
describe('resizable media', () => {
  afterEach(() => window.localStorage.clear());

  it('wraps an attached image so it has a corner to drag', () => {
    const host = parse(renderMarkdown(`![shot](attachments/${ID}.png)`));
    const box = host.querySelector('.nib-media');
    expect(box).not.toBe(null);
    expect(box.dataset.file).toBe(`${ID}.png`);
    expect(box.querySelector('img.nib-sizable')).not.toBe(null);
    expect(box.querySelector('.nib-grip')).not.toBe(null);
  });

  it('gives a video the same corner', () => {
    const host = parse(renderMarkdown(`[clip.mp4](attachments/${ID}.mp4)`));
    expect(host.querySelector('video.nib-sizable')).not.toBe(null);
    expect(host.querySelector('.nib-grip')).not.toBe(null);
  });

  it('leaves audio alone, which has nothing to size', () => {
    const host = parse(renderMarkdown(`[song.mp3](attachments/${ID}.mp3)`));
    expect(host.querySelector('audio')).not.toBe(null);
    expect(host.querySelector('.nib-grip')).toBe(null);
  });

  it('does not touch a picture from elsewhere on the web', () => {
    const host = parse(renderMarkdown('![x](https://example.test/x.png)'));
    expect(host.querySelector('.nib-media')).toBe(null);
    expect(host.querySelector('img')).not.toBe(null);
  });

  it('applies the width the reader last chose', () => {
    setSize(`${ID}.png`, 360);
    const img = parse(renderMarkdown(`![shot](attachments/${ID}.png)`))
      .querySelector('img');
    expect(img.style.width).toBe('360px');
  });

  it('leaves the width alone when nothing was stored', () => {
    const img = parse(renderMarkdown(`![shot](attachments/${ID}.png)`))
      .querySelector('img');
    expect(img.style.width).toBe('');
  });

  it('keeps each file at its own size', () => {
    setSize(`${ID}.png`, 360);
    const src = `![a](attachments/${ID}.png)\n\n![b](attachments/aaaaaaaaaaaaaaaa.png)`;
    const widths = [...parse(renderMarkdown(src)).querySelectorAll('img')]
      .map((el) => el.style.width);
    expect(widths).toEqual(['360px', '']);
  });

  it('keeps the source offsets, and survives being parsed again', () => {
    const src = `text\n\n![shot](attachments/${ID}.png)\n`;
    const once = renderMarkdown(src);
    const host = parse(once);
    expect(host.querySelectorAll('p')).toHaveLength(2);
    expect(host.querySelector('img').closest('p[data-src]')).not.toBe(null);
    expect(host.innerHTML).toBe(once);
  });
});
