import { describe, expect, it } from 'vitest';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { createEditor } from './editorConfig';
import {
  blockRangeAt,
  buildMenu,
  deleteBlock,
  dragHandle,
  duplicateBlock,
  targetRange,
} from './blockMenu';
import { ALL_ITEMS, MENU_GROUPS } from './blockMenuItems';

// A real editor, because the point of these tests is that the ranges line up
// with the document Milkdown actually builds - not with one written by hand.
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
    root,
    crepe,
    markdown: () => crepe.getMarkdown(),
    // The position of the first character of a block, found by its text.
    posOf(text) {
      let at = null;
      view.state.doc.descendants((node, pos) => {
        if (at === null && node.isText && node.text.includes(text)) at = pos;
      });
      if (at === null) throw new Error(`no text ${JSON.stringify(text)} in the document`);
      return at;
    },
  };
}

describe('finding the block the handle is beside', () => {
  it('takes the whole paragraph, not the word under the pointer', async () => {
    const e = await open('first para\n\nsecond para\n');
    const range = blockRangeAt(e.view.state.doc, e.posOf('second'));
    expect(range.node.type.name).toBe('paragraph');
    expect(range.node.textContent).toBe('second para');
  });

  it('takes the whole list, not the item pointed at', async () => {
    // The handle sits beside the block directly under the document, and for a
    // nested item that is the list it lives in.
    const e = await open('- one\n- two\n');
    const range = blockRangeAt(e.view.state.doc, e.posOf('two'));
    expect(range.node.type.name).toContain('list');
    expect(range.node.textContent).toContain('one');
  });

  it('gives nothing for a position outside the document', async () => {
    const e = await open('text\n');
    expect(blockRangeAt(e.view.state.doc, 9999)).toBeNull();
    expect(blockRangeAt(e.view.state.doc, undefined)).toBeNull();
  });
});

describe('deleting a block', () => {
  it('removes that block and leaves the rest', async () => {
    const e = await open('keep me\n\ndelete me\n\nkeep me too\n');
    const range = blockRangeAt(e.view.state.doc, e.posOf('delete me'));
    deleteBlock(e.view.state, e.view.dispatch.bind(e.view), range);
    const out = e.markdown();
    expect(out).not.toContain('delete me');
    expect(out).toContain('keep me');
    expect(out).toContain('keep me too');
  });

  it('removes a whole code block, fence and all', async () => {
    const e = await open('before\n\n```\ncode here\n```\n\nafter\n');
    const range = blockRangeAt(e.view.state.doc, e.posOf('code here'));
    deleteBlock(e.view.state, e.view.dispatch.bind(e.view), range);
    const out = e.markdown();
    expect(out).not.toContain('code here');
    expect(out).not.toContain('```');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('does nothing without a range', async () => {
    const e = await open('untouched\n');
    expect(deleteBlock(e.view.state, e.view.dispatch.bind(e.view), null)).toBe(false);
    expect(e.markdown()).toContain('untouched');
  });
});

describe('duplicating a block', () => {
  it('puts the copy directly after the original', async () => {
    const e = await open('first\n\ncopy me\n\nlast\n');
    const range = blockRangeAt(e.view.state.doc, e.posOf('copy me'));
    duplicateBlock(e.view.state, e.view.dispatch.bind(e.view), range);
    const out = e.markdown();
    expect(out.match(/copy me/g)).toHaveLength(2);
    // and the order is kept
    expect(out.indexOf('first')).toBeLessThan(out.indexOf('copy me'));
    expect(out.indexOf('copy me')).toBeLessThan(out.indexOf('last'));
  });

  it('does nothing without a range', async () => {
    const e = await open('once\n');
    expect(duplicateBlock(e.view.state, e.view.dispatch.bind(e.view), null)).toBe(false);
    expect(e.markdown().match(/once/g)).toHaveLength(1);
  });
});

describe('telling the dots from the plus', () => {
  function handleDom() {
    const wrap = document.createElement('div');
    wrap.className = 'milkdown-block-handle';
    const plus = document.createElement('div');
    plus.className = 'operation-item';
    const dots = document.createElement('div');
    dots.className = 'operation-item';
    wrap.append(plus, dots);
    document.body.append(wrap);
    return { wrap, plus, dots };
  }

  it('answers for the dots and not for the plus', () => {
    const h = handleDom();
    expect(dragHandle(h.dots)).toBe(h.dots);
    // The plus opens the insert menu itself; taking it over would break that.
    expect(dragHandle(h.plus)).toBeNull();
    expect(dragHandle(document.body)).toBeNull();
    h.wrap.remove();
  });
});

describe('pressing the dots never cancels the drag', () => {
  // The regression this file exists to stop coming back: the menu used to open
  // on mousedown and call preventDefault, and the block plugin starts its drag
  // from that same event. Blocks stopped moving at all. Nothing about opening a
  // menu is allowed to prevent the default on a press of the handle.
  it('leaves the pointerdown event alone', async () => {
    const e = await open('a paragraph\n');
    const wrap = document.createElement('div');
    wrap.className = 'milkdown-block-handle';
    const plus = document.createElement('div');
    plus.className = 'operation-item';
    const dots = document.createElement('div');
    dots.className = 'operation-item';
    wrap.append(plus, dots);
    e.root.append(wrap);

    const down = new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, clientX: 10, clientY: 10,
    });
    dots.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);

    const up = new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, clientX: 10, clientY: 10,
    });
    dots.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
  });
});

describe('what the six dots offer', () => {
  it('leads with acting on the block, then changing it, then inserting', () => {
    expect(MENU_GROUPS.map((g) => g.label)).toEqual(['Block', 'Turn into', 'Insert below']);
    expect(MENU_GROUPS[0].items.map((i) => i.label)).toEqual(['Duplicate', 'Delete']);
  });

  it('carries everything the plus menu carries', () => {
    // The ask was that the dots offer what the plus offers, so the two lists
    // not drifting apart is the thing worth asserting.
    const labels = ALL_ITEMS.map((i) => i.label);
    for (const expected of [
      'Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Quote',
      'Bullet list', 'Ordered list', 'Task list', 'Code', 'Divider', 'Image', 'Table',
    ]) {
      expect(labels).toContain(expected);
    }
  });

  it('gives every item an icon and something to run', () => {
    for (const item of ALL_ITEMS) {
      expect(item.icon).toContain('<svg');
      expect(typeof item.run).toBe('function');
    }
  });
});

describe('the menu as it is drawn', () => {
  it('shows an icon and a label for each item, under its group', () => {
    const menu = buildMenu(() => {});
    const labels = [...menu.querySelectorAll('.nib-block-menu-label')].map((n) => n.textContent);
    expect(labels).toEqual(['Block', 'Turn into', 'Insert below']);
    const buttons = [...menu.querySelectorAll('.nib-block-menu-item')];
    expect(buttons).toHaveLength(ALL_ITEMS.length);
    for (const b of buttons) {
      expect(b.querySelector('.nib-block-menu-icon svg')).not.toBeNull();
      expect(b.textContent.trim()).not.toBe('');
    }
  });

  it('marks Delete as the destructive one', () => {
    const menu = buildMenu(() => {});
    const danger = [...menu.querySelectorAll('.nib-block-menu-item.danger')];
    expect(danger).toHaveLength(1);
    expect(danger[0].textContent).toContain('Delete');
  });

  it('picks on mousedown, because the editor loses its selection on blur', () => {
    const picked = [];
    const menu = buildMenu((item) => picked.push(item.key));
    const first = menu.querySelector('.nib-block-menu-item');
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(picked).toEqual([]);
    first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(picked).toEqual(['duplicate']);
  });
});
