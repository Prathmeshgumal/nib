import { describe, expect, it } from 'vitest';
import { actions, toggleTaskAt } from './editorActions';

// Apply an action to a document where | marks the cursor, or |…| a selection.
function run(name, doc, ...args) {
  const first = doc.indexOf('|');
  const rest = doc.slice(first + 1).indexOf('|');
  const value = doc.replace(/\|/g, '');
  const start = first;
  const end = rest === -1 ? first : first + rest;
  const out = actions[name]({ value, start, end }, ...args);
  return out.value;
}

describe('toggleTask', () => {
  it('ticks an unticked task', () => {
    expect(run('toggleTask', '- [ ] buy mi|lk')).toBe('- [x] buy milk');
  });

  it('unticks a ticked task', () => {
    expect(run('toggleTask', '- [x] buy mi|lk')).toBe('- [ ] buy milk');
  });

  it('accepts a capital X, as the parser does', () => {
    expect(run('toggleTask', '- [X] buy mi|lk')).toBe('- [ ] buy milk');
  });

  it('turns a plain bullet into an unticked task', () => {
    expect(run('toggleTask', '- buy mi|lk')).toBe('- [ ] buy milk');
  });

  it('turns a plain line into a task', () => {
    expect(run('toggleTask', 'buy mi|lk')).toBe('- [ ] buy milk');
  });

  it('keeps the indent of a nested item', () => {
    expect(run('toggleTask', '   - [ ] nest|ed')).toBe('   - [x] nested');
  });

  it('toggles every line of a selection', () => {
    expect(run('toggleTask', '|- [ ] one\n- [ ] two|')).toBe('- [x] one\n- [x] two');
  });
});

describe('indent and outdent', () => {
  it('indents a list item by two spaces', () => {
    expect(run('indent', '- it|em')).toBe('  - item');
  });

  it('outdents an indented item', () => {
    expect(run('outdent', '  - it|em')).toBe('- item');
  });

  it('will not outdent past the left margin', () => {
    expect(run('outdent', '- it|em')).toBe('- item');
  });

  it('outdents a partial indent rather than refusing', () => {
    expect(run('outdent', ' - it|em')).toBe('- item');
  });

  it('indents every line of a selection', () => {
    expect(run('indent', '|- one\n- two|')).toBe('  - one\n  - two');
  });

  it('leaves a numbered item numbered when indenting', () => {
    expect(run('indent', '1. it|em')).toBe('  1. item');
  });
});

// Ticking a box from the rendered view, which the terminal cannot do at all.
describe('toggleTaskAt', () => {
  const doc = '# Shopping\n\n- [ ] milk\n- [x] eggs\n';

  it('ticks the box on the line at the given offset', () => {
    expect(toggleTaskAt(doc, doc.indexOf('- [ ] milk'))).toBe(
      '# Shopping\n\n- [x] milk\n- [x] eggs\n'
    );
  });

  it('unticks a ticked box', () => {
    expect(toggleTaskAt(doc, doc.indexOf('- [x] eggs'))).toBe(
      '# Shopping\n\n- [ ] milk\n- [ ] eggs\n'
    );
  });

  it('leaves a line that is not a task alone', () => {
    expect(toggleTaskAt(doc, doc.indexOf('# Shopping'))).toBe(doc);
  });

  it('returns the document unchanged for an out-of-range offset', () => {
    expect(toggleTaskAt(doc, 9999)).toBe(doc);
  });
});
