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
