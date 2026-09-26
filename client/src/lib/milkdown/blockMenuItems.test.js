import { describe, expect, it } from 'vitest';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { createEditor } from './editorConfig';
import { ALL_ITEMS } from './blockMenuItems';

async function open(markdown) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const crepe = createEditor(root, { markdown });
  await crepe.create();
  let view;
  crepe.editor.action((ctx) => {
    view = ctx.get(editorViewCtx);
  });
  const cursorOn = (text) => {
    let at = null;
    view.state.doc.descendants((node, pos) => {
      if (at === null && node.isText && node.text.includes(text)) at = pos;
    });
    if (at === null) throw new Error(`no text ${JSON.stringify(text)}`);
    view.dispatch(view.state.tr.setSelection(
      TextSelection.near(view.state.doc.resolve(at)),
    ));
  };
  const run = (label) => {
    const item = ALL_ITEMS.find((i) => i.label === label);
    if (!item) throw new Error(`no menu item ${JSON.stringify(label)}`);
    crepe.editor.action((ctx) => item.run(ctx));
  };
  return { view, cursorOn, run, markdown: () => crepe.getMarkdown() };
}

// The reason this menu exists rather than Crepe's: every item in Crepe's slash
// menu calls clearTextInCurrentBlockCommand first, because it is there to clear
// the `/quote` you typed to summon it. Run from a handle, against a paragraph
// that already holds a sentence, that deletes the sentence.
describe('turning a block into something else keeps what is in it', () => {
  const cases = [
    ['Heading 1', '# keep this text'],
    ['Heading 2', '## keep this text'],
    ['Heading 3', '### keep this text'],
    ['Quote', '> keep this text'],
    ['Bullet list', '- keep this text'],
  ];

  for (const [label, expected] of cases) {
    it(`${label} keeps the words`, async () => {
      const e = await open('keep this text\n');
      e.cursorOn('keep this');
      e.run(label);
      const out = e.markdown();
      expect(out).toContain('keep this text');
      expect(out.trim()).toContain(expected);
    });
  }

  it('Text turns a heading back into a paragraph, words intact', async () => {
    const e = await open('## a heading\n');
    e.cursorOn('a heading');
    e.run('Text');
    const out = e.markdown();
    expect(out).toContain('a heading');
    expect(out).not.toContain('## a heading');
  });

  it('leaves the other blocks alone', async () => {
    const e = await open('first\n\nchange me\n\nlast\n');
    e.cursorOn('change me');
    e.run('Heading 2');
    const out = e.markdown();
    expect(out).toContain('## change me');
    expect(out).toContain('first');
    expect(out).toContain('last');
  });
});

describe('inserting below', () => {
  it('adds a divider without disturbing the block above', async () => {
    const e = await open('a paragraph\n');
    e.cursorOn('a paragraph');
    e.run('Divider');
    const out = e.markdown();
    expect(out).toContain('a paragraph');
    expect(out).toMatch(/^-{3,}$/m);
  });
});
