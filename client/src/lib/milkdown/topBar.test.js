import { describe, expect, it } from 'vitest';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { createEditor } from './editorConfig';
import { HEADING_BUTTONS, buildTopBar, isHeadingActive, toggleHeading } from './topBar';

async function open(markdown) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const crepe = createEditor(root, { markdown });
  await crepe.create();
  let view;
  crepe.editor.action((ctx) => {
    view = ctx.get(editorViewCtx);
  });
  return {
    view,
    act: (fn) => crepe.editor.action(fn),
    markdown: () => crepe.getMarkdown(),
    putCursorIn(text) {
      let at = null;
      view.state.doc.descendants((node, pos) => {
        if (at === null && node.isText && node.text.includes(text)) at = pos;
      });
      if (at === null) throw new Error(`no text ${JSON.stringify(text)}`);
      view.dispatch(view.state.tr.setSelection(
        TextSelection.near(view.state.doc.resolve(at)),
      ));
    },
  };
}

function fakeBuilder() {
  const items = [];
  return {
    items,
    addGroup: (key, label) => ({
      addItem: (itemKey, item) => items.push({ group: key, key: itemKey, ...item }),
    }),
  };
}

describe('headings on the toolbar', () => {
  it('adds a button for the three levels people reach for', () => {
    const b = fakeBuilder();
    buildTopBar(b);
    expect(b.items).toHaveLength(HEADING_BUTTONS.length);
    for (const item of b.items) {
      expect(item.icon).toContain('<svg');
      expect(typeof item.onRun).toBe('function');
      expect(typeof item.active).toBe('function');
    }
  });

  it('turns a paragraph into a heading', async () => {
    const e = await open('just text\n');
    e.putCursorIn('just text');
    e.act((ctx) => toggleHeading(ctx, 2));
    expect(e.markdown()).toContain('## just text');
  });

  it('turns the heading back into a paragraph when pressed again', async () => {
    // A toggle, like bold and italic beside it - not a one-way trip that
    // leaves you hunting the dropdown to undo what a button just did.
    const e = await open('a line\n');
    e.putCursorIn('a line');
    e.act((ctx) => toggleHeading(ctx, 1));
    expect(e.markdown()).toContain('# a line');
    e.act((ctx) => toggleHeading(ctx, 1));
    const out = e.markdown();
    expect(out).toContain('a line');
    expect(out).not.toContain('# a line');
  });

  it('reports which level the cursor is in', async () => {
    const e = await open('### deep\n');
    e.putCursorIn('deep');
    e.act((ctx) => {
      expect(isHeadingActive(ctx, 3)).toBe(true);
      expect(isHeadingActive(ctx, 1)).toBe(false);
    });
  });

  it('switches straight from one level to another', async () => {
    const e = await open('# big\n');
    e.putCursorIn('big');
    e.act((ctx) => toggleHeading(ctx, 3));
    expect(e.markdown()).toContain('### big');
  });
});
