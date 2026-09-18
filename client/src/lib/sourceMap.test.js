import { describe, expect, it } from 'vitest';
import { blockSpans, offsetFromClick, stampTargets } from './sourceMap';

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
