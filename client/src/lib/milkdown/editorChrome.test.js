import { describe, expect, it } from 'vitest';
import { clearOfBar, labelBlockHandle, besideSelection } from './editorChrome';
import { TOP_BAR_LABELS, buildTopBar, labelTopBar } from './topBar';

const boxed = (rect, top = '0px') => {
  const el = document.createElement('div');
  el.style.top = top;
  el.getBoundingClientRect = () => ({ ...rect, height: rect.bottom - rect.top });
  return el;
};

describe('the bubble over a selection', () => {
  it('moves below the selection when it lands on the top bar', () => {
    // The numbers from the bug: bubble 81-125, bar 85-130, text ending at 160.
    const bubble = boxed({ top: 81, bottom: 125 }, '40px');
    const bar = boxed({ top: 85, bottom: 130 });
    expect(clearOfBar(bubble, bar, 160)).toBe(40 + (170 - 81));
  });

  it('stays put when it is clear of the bar', () => {
    const bubble = boxed({ top: 300, bottom: 344 });
    const bar = boxed({ top: 85, bottom: 130 });
    expect(clearOfBar(bubble, bar, 360)).toBeNull();
  });
});

// The box for pasting a link, and the one that previews a link. Crepe places
// both flush against the text with no gap, so they covered the top of what was
// selected, and on a note's first line they slid under the top bar.
describe('the link boxes', () => {
  // The numbers from the bug: box 107-139, bar ending at 108, text 132-165.
  const bar = boxed({ top: 52, bottom: 108 });

  it('goes below the text when there is no room above it', () => {
    const box = boxed({ top: 107, bottom: 139 }, '60px');
    // Below the selection, with the gap: 165 + 10 = 175.
    expect(besideSelection(box, bar, 132, 165)).toBe(60 + (175 - 107));
  });

  it('keeps a gap above the text when there is room', () => {
    const box = boxed({ top: 268, bottom: 300 }, '200px');
    // Above it, clear of it: 300 - 10 - 32 = 258.
    expect(besideSelection(box, bar, 300, 330)).toBe(200 + (258 - 268));
  });

  it('leaves a box that is already in place alone', () => {
    const box = boxed({ top: 258, bottom: 290 }, '190px');
    expect(besideSelection(box, bar, 300, 330)).toBeNull();
  });

  it('leaves a hidden box alone', () => {
    const box = boxed({ top: 0, bottom: 0 });
    expect(besideSelection(box, bar, 300, 330)).toBeNull();
  });
});

describe('names on the top bar', () => {
  // A stand-in for Crepe's builder, with the groups it really adds.
  function builder() {
    const groups = [];
    const add = (key) => {
      const group = { key, items: [] };
      groups.push(group);
      const api = {
        addItem: (k, item) => {
          group.items.push({ key: k, ...item });
          return api;
        },
      };
      return api;
    };
    const run = () => {};
    add('heading').addItem('heading-selector', { selector: {} });
    add('formatting').addItem('bold', { onRun: run }).addItem('italic', { onRun: run });
    add('more').addItem('quote', { onRun: run });
    return { groups, addGroup: add, build: () => groups };
  }

  it('drops the heading dropdown and puts the heading buttons first', () => {
    const b = builder();
    buildTopBar(b);
    expect(b.groups.map((g) => g.key)).toEqual(['nibHeadings', 'formatting', 'more']);
  });

  it('gives every drawn button a name and a tooltip', () => {
    const b = builder();
    buildTopBar(b);
    const bar = document.createElement('div');
    const keys = b.groups.flatMap((g) => g.items.map((i) => i.key));
    bar.innerHTML = keys.map(() => '<button class="top-bar-item"></button>').join('');
    labelTopBar(bar, keys);
    const names = [...bar.querySelectorAll('button')].map((x) => x.getAttribute('aria-label'));
    expect(names).toEqual(keys.map((k) => TOP_BAR_LABELS[k]));
    expect(bar.querySelector('button').title).toBe('Heading 1');
    expect(bar.getAttribute('role')).toBe('toolbar');
  });
});

describe('the plus and the dots beside a block', () => {
  it('are named for what they do', () => {
    const handle = document.createElement('div');
    handle.innerHTML = '<div class="operation-item"></div><div class="operation-item"></div>';
    labelBlockHandle(handle);
    const [plus, dots] = handle.querySelectorAll('.operation-item');
    expect(plus.getAttribute('aria-label')).toBe('Add a block below');
    expect(dots.getAttribute('aria-label')).toMatch(/Drag to move/);
    expect(dots.getAttribute('role')).toBe('button');
  });
});
