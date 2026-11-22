import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { labelTopBar } from './topBar';

// Everything Crepe draws around the writing but leaves unnamed or misplaced:
// the bar at the top, the bubble over a selection, and the plus and dots
// beside each block. Crepe renders all three itself, and re-renders them as the
// selection moves, so this watches them and puts right what it needs to each
// time they change.

export const editorChromeKey = new PluginKey('nibEditorChrome');

// How far below the selection the bubble sits when it has to move. Crepe puts
// it 10px above.
const GAP = 10;

// The bubble over a selection is placed above it - which, on the first lines
// of a note, is exactly where the sticky bar at the top lives. The two drew on
// top of each other at the same depth and in the same colour, and read as one
// bar of jumbled icons. When they meet, the bubble goes below the selection.
//
// Returns the new `top`, or null when the bubble can stay where it is.
export function clearOfBar(bubble, bar, selectionBottom) {
  if (!bubble || !bar) return null;
  const a = bubble.getBoundingClientRect();
  const b = bar.getBoundingClientRect();
  const overlaps = a.top < b.bottom && a.bottom > b.top && a.height > 0;
  if (!overlaps) return null;
  const current = parseFloat(bubble.style.top) || 0;
  return current + (selectionBottom + GAP - a.top);
}

// The box for pasting a link. Crepe places it
// flush against the text, with no gap at all, so it covered the top of what
// was selected - and on a note's first line, where the space above belongs to
// the sticky bar, it slid underneath it and lost its top edge. It sits a
// gap above the text when there is room, and a gap below it when there is not.
//
// Returns the new `top`, or null when the box can stay where it is.
export function besideSelection(box, bar, selectionTop, selectionBottom) {
  if (!box) return null;
  const a = box.getBoundingClientRect();
  const height = a.bottom - a.top;
  if (height <= 0) return null;
  const barBottom = bar ? bar.getBoundingClientRect().bottom : -Infinity;
  const above = selectionTop - GAP - height;
  const want = above >= barBottom ? above : selectionBottom + GAP;
  if (Math.abs(a.top - want) < 1) return null;
  const current = parseFloat(box.style.top) || 0;
  return current + (want - a.top);
}

// The plus and the dots are plain divs. They get names, so a screen reader can
// say what they are and a pointer resting on one gets a tooltip.
export function labelBlockHandle(handle) {
  if (!handle) return;
  const items = handle.querySelectorAll('.operation-item');
  const labels = ['Add a block below', 'Drag to move, click for options (Ctrl+/)'];
  items.forEach((item, i) => {
    const label = labels[i + labels.length - items.length];
    if (!label || item.getAttribute('aria-label') === label) return;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', label);
    item.title = label;
  });
}

export const editorChrome = $prose(() => new Plugin({
  key: editorChromeKey,
  view: (view) => {
    let frame = 0;

    const sync = () => {
      frame = 0;
      const root = view.dom.closest('.milkdown');
      if (!root) return;
      const bar = root.querySelector('.milkdown-top-bar');
      if (bar) labelTopBar(bar);
      labelBlockHandle(root.querySelector('.milkdown-block-handle'));

      let from;
      let to;
      try {
        from = view.coordsAtPos(view.state.selection.from);
        to = view.coordsAtPos(view.state.selection.to);
      } catch {
        return;
      }

      const bubble = root.querySelector('.milkdown-toolbar');
      if (bubble?.dataset.show === 'true') {
        const top = clearOfBar(bubble, bar, to.bottom);
        if (top !== null) bubble.style.top = `${top}px`;
      }

      // Only the box for pasting a link hangs off the selection. The preview
      // hangs off whichever link is under the pointer, which Crepe places.
      const linkEdit = root.querySelector('.milkdown-link-edit');
      if (linkEdit?.dataset.show === 'true') {
        const top = besideSelection(linkEdit, bar, Math.min(from.top, to.top), Math.max(from.bottom, to.bottom));
        if (top !== null) linkEdit.style.top = `${top}px`;
      }
    };

    // One pass per frame, however many changes land in it.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };

    const observer = new MutationObserver((records) => {
      // Typing changes the document constantly and none of it is chrome.
      if (records.every((r) => view.dom.contains(r.target))) return;
      schedule();
    });

    // The root is not there until the editor has been placed in the page.
    const start = () => {
      const root = view.dom.closest('.milkdown');
      if (!root) {
        frame = requestAnimationFrame(start);
        return;
      }
      frame = 0;
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'data-show'],
      });
      sync();
    };
    start();

    return {
      update: schedule,
      destroy: () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
      },
    };
  },
}));
