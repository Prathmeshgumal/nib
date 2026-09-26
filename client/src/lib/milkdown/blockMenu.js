import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { TextSelection } from '@milkdown/kit/prose/state';
import { MENU_GROUPS } from './blockMenuItems';
import { blockRangeAt } from './blockOps';

// Re-exported so the menu, the plugin and the tests all name one place.
export { blockRangeAt, deleteBlock, duplicateBlock, targetRange } from './blockOps';

// Crepe's block handle drags and nothing else: the plus inserts a block below,
// the dots move the block, and there is no way to change or remove one. Every
// editor this is measured against puts a menu behind those dots, so this adds
// one - Crepe's own, rather than a second menu of our making.
//
// The hit-testing and the editing are kept apart on purpose. Working out which
// block sits under a pointer needs layout, which jsdom does not have; working
// out what to do with that block does not. Everything below the first function
// is therefore testable, and is tested.

export const blockMenuKey = new PluginKey('nibBlockMenu');

// How far the pointer may wander between press and release and still count as
// a click. Below this a hand is holding still; above it, it is dragging.
const DRAG_SLOP = 4;

// The dots. Crepe renders the plus first and the handle second, and only the
// plus carries handlers of its own.
export function dragHandle(target) {
  const item = target.closest?.('.milkdown-block-handle .operation-item');
  if (!item) return null;
  const all = [...item.parentElement.querySelectorAll('.operation-item')];
  return all.indexOf(item) === all.length - 1 ? item : null;
}

// The menu itself. Built here rather than inside the plugin so a test can
// render it without standing up an editor.
export function buildMenu(onPick) {
  const menu = document.createElement('div');
  menu.className = 'nib-block-menu';
  menu.setAttribute('role', 'menu');
  for (const group of MENU_GROUPS) {
    const label = document.createElement('div');
    label.className = 'nib-block-menu-label';
    label.textContent = group.label;
    menu.append(label);
    for (const item of group.items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.className = item.danger
        ? 'nib-block-menu-item danger'
        : 'nib-block-menu-item';
      const glyph = document.createElement('span');
      glyph.className = 'nib-block-menu-icon';
      glyph.innerHTML = item.icon;
      const text = document.createElement('span');
      text.textContent = item.label;
      button.append(glyph, text);
      button.addEventListener('mousedown', (e) => {
        // mousedown, not click: the editor loses its selection on blur, and by
        // the time a click lands there is nothing left to act on.
        e.preventDefault();
        e.stopPropagation();
        onPick(item);
      });
      menu.append(button);
    }
  }
  return menu;
}

export const blockMenu = $prose((ctx) => {
  return new Plugin({
    key: blockMenuKey,
    view: (view) => {
      let menu = null;
      // Where the pointer went down on the dots, and which block it was
      // beside. Null whenever the press did not start on the handle.
      let pressed = null;

      const close = () => {
        menu?.remove();
        menu = null;
      };

      const open = (handle, pos) => {
        close();
        menu = buildMenu((item) => {
          close();
          // The item acts on whatever the selection is in, so the selection
          // has to be inside the block the dots belong to first.
          const { state } = view;
          const range = blockRangeAt(state.doc, pos);
          if (range) {
            view.dispatch(state.tr.setSelection(
              TextSelection.near(state.doc.resolve(range.from + 1)),
            ));
          }
          if (!view.hasFocus()) view.focus();
          item.run(ctx);
        });
        document.body.append(menu);
        // Placed under the dots, and pulled back inside the window when the
        // block is far enough down the page that the menu would hang off it.
        const box = handle.getBoundingClientRect();
        menu.style.visibility = 'hidden';
        const height = menu.getBoundingClientRect().height;
        const top = box.bottom + 4 + height > window.innerHeight
          ? Math.max(8, box.top - height - 4)
          : box.bottom + 4;
        menu.style.top = `${top + window.scrollY}px`;
        menu.style.left = `${box.left + window.scrollX}px`;
        menu.style.visibility = '';
      };

      const blockPosUnder = (handle) => {
        // The handle is beside the block, so a point just inside the editor's
        // left edge at the handle's own height lands in it.
        const box = handle.getBoundingClientRect();
        const editor = view.dom.getBoundingClientRect();
        const found = view.posAtCoords({
          left: editor.left + 8,
          top: box.top + box.height / 2,
        });
        return found?.pos ?? null;
      };

      const onPointerDown = (event) => {
        if (menu && !menu.contains(event.target)) close();
        pressed = null;
        const handle = dragHandle(event.target);
        if (!handle) return;
        const pos = blockPosUnder(handle);
        if (pos == null) return;
        // Deliberately no preventDefault. The block plugin begins its drag
        // from this very event, and calling it is what stopped blocks moving
        // at all once this menu existed.
        pressed = { x: event.clientX, y: event.clientY, pos, handle };
      };

      const onPointerUp = (event) => {
        const start = pressed;
        pressed = null;
        if (!start) return;
        const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        // A drag has already done what it was for; opening a menu on top of
        // where it landed would undo the gesture the hand just made.
        if (moved > DRAG_SLOP) return;
        open(start.handle, start.pos);
      };

      const onKeyDown = (event) => {
        if (event.key === 'Escape') close();
      };

      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('pointerup', onPointerUp, true);
      document.addEventListener('keydown', onKeyDown);
      window.addEventListener('scroll', close, true);

      return {
        destroy: () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('pointerup', onPointerUp, true);
          document.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('scroll', close, true);
          close();
        },
      };
    },
  });
});
