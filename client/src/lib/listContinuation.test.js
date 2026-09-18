import { describe, expect, it } from 'vitest';
import { continuation, enterInList, plainBreak } from './listContinuation';

// These cases are ported verbatim from internal/tui/continue_test.go. The two
// editors are meant to behave identically, so the table is the contract: if the
// Go side changes, this file should change with it.
describe('continuation', () => {
  const cases = [
    ['bullet', '- buy milk', '- ', false],
    ['star bullet', '* buy milk', '* ', false],
    ['plus bullet', '+ buy milk', '+ ', false],
    ['task', '- [ ] buy milk', '- [ ] ', false],
    ['finished task starts a fresh one', '- [x] buy milk', '- [ ] ', false],
    ['numbered', '1. first', '2. ', false],
    ['numbered keeps counting', '9. ninth', '10. ', false],
    ['numbered with a paren', '3) third', '4) ', false],
    ['quote', '> a thought', '> ', false],
    ['nested quote', '> > deeper', '> > ', false],

    ['indented bullet keeps its indent', '   - nested', '   - ', false],
    ['indented task', '   - [ ] nested', '   - [ ] ', false],
    ['indented numbered', '  2. second', '  3. ', false],

    ['empty bullet ends the list', '- ', '', true],
    ['empty task ends the list', '- [ ] ', '', true],
    ['empty numbered ends the list', '1. ', '', true],
    ['empty quote ends it', '> ', '', true],

    ['ordinary prose', 'just a sentence', '', false],
    ['heading', '# A heading', '', false],
    ['empty line', '', '', false],
    ['a rule is not a list', '---', '', false],
  ];

  for (const [name, line, prefix, endList] of cases) {
    it(name, () => {
      expect(continuation(line)).toEqual({ prefix, endList });
    });
  }
});

// Typing the text, then pressing Enter. `|` marks where the cursor ends up.
function typeThenEnter(typed) {
  const { value, caret } = enterInList(typed, typed.length);
  return value.slice(0, caret) + '|' + value.slice(caret);
}

describe('pressing Enter', () => {
  it('carries a task list on, with the cursor inside the new item', () => {
    expect(typeThenEnter('- [ ] first')).toBe('- [ ] first\n- [ ] |');
  });

  it('carries a bullet list on', () => {
    expect(typeThenEnter('- first')).toBe('- first\n- |');
  });

  it('keeps counting a numbered list', () => {
    expect(typeThenEnter('1. first')).toBe('1. first\n2. |');
  });

  it('carries a quote on', () => {
    expect(typeThenEnter('> first')).toBe('> first\n> |');
  });

  it('keeps the indent of a nested item', () => {
    expect(typeThenEnter('   - [ ] first')).toBe('   - [ ] first\n   - [ ] |');
  });

  it('leaves prose alone', () => {
    expect(typeThenEnter('just a sentence')).toBe('just a sentence\n|');
  });

  it('ends the list on an item with nothing in it', () => {
    // The marker is cleared rather than repeated, and no new line is added.
    expect(typeThenEnter('- [ ] milk\n- [ ] ')).toBe('- [ ] milk\n|');
  });

  it('carries on in the middle of a document, not only at the end', () => {
    const doc = '- one\ntrailing paragraph';
    const { value, caret } = enterInList(doc, '- one'.length);
    expect(value).toBe('- one\n- \ntrailing paragraph');
    expect(value.slice(0, caret)).toBe('- one\n- ');
  });

  it('splits the text when Enter is pressed mid-item', () => {
    const doc = '- one two';
    const { value, caret } = enterInList(doc, '- one'.length);
    expect(value).toBe('- one\n-  two');
    expect(value.slice(0, caret)).toBe('- one\n- ');
  });

  it('replaces a selection before continuing', () => {
    const doc = '- keep this too';
    const { value } = enterInList(doc, '- keep'.length, doc.length);
    expect(value).toBe('- keep\n- ');
  });
});

describe('Shift+Enter', () => {
  it('breaks the line without carrying the list on', () => {
    // The terminal cannot tell Shift+Enter from Enter, so the TUI spends alt+
    // on this. A browser can, so the web gets the gesture everyone expects.
    const typed = '- [ ] milk';
    const { value, caret } = plainBreak(typed, typed.length);
    expect(value).toBe('- [ ] milk\n');
    expect(caret).toBe(value.length);
  });
});
