import { describe, expect, it } from 'vitest';
import { blockSpans, offsetFromClick, scrollCaretIntoView, stampTargets } from './sourceMap';

// The note that prompted this feature: a heading, prose, a wide table and a
// nested list.
const DOC = [
  '# Companies Breakdown',
  '',
  'A **bold** word and a [link](https://example.com).',
  '',
  '| # | Company | CTC |',
  '| - | ------- | --- |',
  '| 1 | Google | 30L |',
  '| 2 | Microsoft | 25L |',
  '| 3 | Stripe | 50L |',
  '',
  '- A database allows reads and writes.',
  '  - In any application there are more reads.',
  '    - Deeply nested item',
  '- Second top-level item',
  '',
  '> quoted text',
  '',
  '```',
  'code here',
  '```',
  '',
  'Final paragraph.',
].join('\n');

describe('blockSpans', () => {
  it('starts every span at the first character of its block', () => {
    const at = (needle) => DOC.indexOf(needle);
    const starts = blockSpans(DOC).map((s) => s.start);
    for (const needle of [
      '# Companies Breakdown',
      'A **bold**',
      '| 1 | Google',
      '| 3 | Stripe',
      '- A database',
      '  - In any application',
      '    - Deeply nested item',
      '- Second top-level item',
      '> quoted text',
      'Final paragraph.',
    ]) {
      expect(starts).toContain(at(needle));
    }
  });

  it('gives a nested bullet its own span, not its parent-s', () => {
    const spans = blockSpans(DOC).filter((s) => s.type === 'list_item');
    expect(spans).toHaveLength(4);
    expect(DOC.slice(spans[2].start, spans[2].end)).toBe('    - Deeply nested item');
  });

  it('gives one span per table data row and none for the header', () => {
    const rows = blockSpans(DOC).filter((s) => s.type === 'table_row');
    expect(rows.map((r) => DOC.slice(r.start, r.end))).toEqual([
      '| 1 | Google | 30L |',
      '| 2 | Microsoft | 25L |',
      '| 3 | Stripe | 50L |',
    ]);
  });

  it('never returns an empty span', () => {
    for (const s of blockSpans(DOC)) expect(s.end).toBeGreaterThan(s.start);
  });

  it('handles an empty note', () => {
    expect(blockSpans('')).toEqual([]);
    expect(blockSpans(undefined)).toEqual([]);
  });
});

function render(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('stampTargets', () => {
  it('returns one element per span, in the same order', () => {
    const host = render(
      '<h1>h</h1>' +
        '<table><thead><tr><th>#</th></tr></thead><tbody><tr><td>1</td></tr><tr><td>2</td></tr></tbody></table>' +
        '<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>' +
        '<p>p</p>'
    );
    expect(stampTargets(host).map((el) => el.tagName)).toEqual([
      'H1', 'TR', 'TR', 'LI', 'LI', 'LI', 'P',
    ]);
  });

  it('does not descend into a blockquote, which is one block', () => {
    const host = render('<blockquote><p>a</p><p>b</p></blockquote>');
    expect(stampTargets(host).map((el) => el.tagName)).toEqual(['BLOCKQUOTE']);
  });
});

describe('offsetFromClick', () => {
  it('finds the offset on the nearest stamped ancestor', () => {
    const host = render('<p data-src="42">a <strong>word</strong></p>');
    const strong = host.querySelector('strong');
    expect(offsetFromClick(strong.firstChild, host)).toBe(42);
  });

  it('returns null for a click on padding, above every stamped element', () => {
    const host = render('<p data-src="42">a</p>');
    expect(offsetFromClick(host, host)).toBeNull();
  });
});

it('scrolls a long note so the caret line is roughly centred', () => {
  const el = document.createElement('textarea');
  el.value = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
  document.body.appendChild(el);
  Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
  el.style.lineHeight = '20px';

  const offset = el.value.indexOf('line 100');
  scrollCaretIntoView(el, offset);
  // line 100 sits at 2000px; centring it in a 300px box puts the top at 1850.
  expect(el.scrollTop).toBe(1850);
});

it('does not scroll above the top for a caret on the first line', () => {
  const el = document.createElement('textarea');
  el.value = 'first\nsecond';
  document.body.appendChild(el);
  scrollCaretIntoView(el, 0);
  expect(el.scrollTop).toBe(0);
});
