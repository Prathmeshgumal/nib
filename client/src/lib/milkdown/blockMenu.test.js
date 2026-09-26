import { describe, expect, it } from 'vitest';
import { editorViewCtx } from '@milkdown/kit/core';
import { createEditor } from './editorConfig';
import { blockRangeAt, deleteBlock, duplicateBlock } from './blockMenu';

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
