import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

// Crepe's block handle drags and nothing else: the plus opens the slash menu,
// the dots move the block, and there is no way to get rid of one. Every editor
// this is measured against puts a menu behind those dots, so this adds it.
//
// The hit-testing and the editing are kept apart on purpose. Working out which
// block sits under a pointer needs layout, which jsdom does not have; working
// out what to do with that block does not. Everything below the first function
// is therefore testable, and is tested.

export const blockMenuKey = new PluginKey('nibBlockMenu');

// The top-level block containing a position - the unit the handle addresses.
// A paragraph nested three lists deep still belongs to whichever block sits
// directly under the document, because that is the thing the handle is beside.
export function blockRangeAt(doc, pos) {
  if (pos == null || pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  const from = $pos.depth === 0 ? $pos.pos : $pos.before(1);
  const node = doc.nodeAt(from);
  if (!node) return null;
  return { from, to: from + node.nodeSize, node };
}

export function deleteBlock(state, dispatch, range) {
  if (!range) return false;
  dispatch?.(state.tr.delete(range.from, range.to).scrollIntoView());
  return true;
}

export function duplicateBlock(state, dispatch, range) {
  if (!range) return false;
  // Inserted at the end of the block rather than the start, so the copy lands
  // under the original and the original keeps its place.
  dispatch?.(state.tr.insert(range.to, range.node).scrollIntoView());
  return true;
}

const ITEMS = [
  { label: 'Duplicate', run: duplicateBlock },
  { label: 'Delete', run: deleteBlock, danger: true },
];

function buildMenu(onPick) {
  const menu = document.createElement('div');
  menu.className = 'nib-block-menu';
  menu.setAttribute('role', 'menu');
  for (const item of ITEMS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.className = item.danger ? 'nib-block-menu-item danger' : 'nib-block-menu-item';
    button.textContent = item.label;
    button.addEventListener('mousedown', (e) => {
      // mousedown, not click: the editor loses its selection on blur, and by
      // the time a click lands there is nothing left to act on.
      e.preventDefault();
      e.stopPropagation();
      onPick(item);
    });
    menu.append(button);
  }
  return menu;
}

// The dots. Crepe renders the plus first and the drag handle second, and only
// the plus carries a click of its own.
function dragHandle(target) {
  const item = target.closest?.('.milkdown-block-handle .operation-item');
  if (!item) return null;
  const all = [...item.parentElement.querySelectorAll('.operation-item')];
  return all.indexOf(item) === all.length - 1 ? item : null;
}

export const blockMenu = $prose(() => {
  let menu = null;
  let close = () => {};

  return new Plugin({
    key: blockMenuKey,
    view: (view) => {
      const open = (handle, range) => {
        close();
        menu = buildMenu((item) => {
          item.run(view.state, view.dispatch.bind(view), range);
          close();
          view.focus();
        });
        document.body.append(menu);
        const box = handle.getBoundingClientRect();
        menu.style.top = `${box.bottom + window.scrollY + 4}px`;
        menu.style.left = `${box.left + window.scrollX}px`;
      };

      close = () => {
        menu?.remove();
        menu = null;
      };

      const onMouseDown = (event) => {
        if (menu && !menu.contains(event.target)) close();
        const handle = dragHandle(event.target);
        if (!handle) return;
        // The handle is beside the block, so a point just inside the editor's
        // left edge at the handle's own height lands in it.
        const box = handle.getBoundingClientRect();
        const editor = view.dom.getBoundingClientRect();
        const found = view.posAtCoords({
          left: editor.left + 8,
          top: box.top + box.height / 2,
        });
        const range = blockRangeAt(view.state.doc, found?.pos);
        if (!range) return;
        event.preventDefault();
        open(handle, range);
      };

      const onKeyDown = (event) => {
        if (event.key === 'Escape') close();
      };

      document.addEventListener('mousedown', onMouseDown, true);
      document.addEventListener('keydown', onKeyDown);
      window.addEventListener('scroll', () => close(), true);

      return {
        destroy: () => {
          document.removeEventListener('mousedown', onMouseDown, true);
          document.removeEventListener('keydown', onKeyDown);
          close();
        },
      };
    },
  });
});
