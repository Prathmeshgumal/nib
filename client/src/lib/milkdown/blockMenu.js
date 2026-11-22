import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { MENU_GROUPS } from './blockMenuItems';
import { blockRangeAt, selectBlock } from './blockOps';

// Re-exported so the menu, the plugin and the tests all name one place.
export { blockRangeAt, deleteBlock, duplicateBlock, selectBlock, targetRange } from './blockOps';

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
      // Enter and Space are caught as keys, not as the click they would turn
      // into: clicks are deliberately ignored, see mousedown above.
      button.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        onPick(item);
      });
      menu.append(button);
    }
  }
  // Arrow keys walk the items, wrapping at either end, the way every other
  // menu on the page does.
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('.nib-block-menu-item')];
    const at = items.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = items[(at + 1) % items.length];
    else if (e.key === 'ArrowUp') next = items[(at - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
  });
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

      // `anchor` is the box the menu hangs from: the dots when it was
      // clicked open, the start of the block when it came from the keyboard.
      const open = (anchor, pos) => {
        close();
        menu = buildMenu((item) => {
          close();
          // The item acts on whatever the selection is in, so the selection
          // has to be inside the block the dots belong to first.
          const { state } = view;
          const selection = selectBlock(state.doc, blockRangeAt(state.doc, pos));
          if (selection) view.dispatch(state.tr.setSelection(selection));
          if (!view.hasFocus()) view.focus();
          item.run(ctx);
        });
        document.body.append(menu);
        // Tabbing out of the menu, or into another field, leaves it behind.
        menu.addEventListener('focusout', (e) => {
          if (e.relatedTarget && !menu?.contains(e.relatedTarget)) close();
        });
        // Placed under the dots, and pulled back inside the window when the
        // block is far enough down the page that the menu would hang off it.
        const box = anchor.getBoundingClientRect?.() ?? anchor;
        menu.style.visibility = 'hidden';
        const height = menu.getBoundingClientRect().height;
        const top = box.bottom + 4 + height > window.innerHeight
          ? Math.max(8, box.top - height - 4)
          : box.bottom + 4;
        menu.style.top = `${top + window.scrollY}px`;
        menu.style.left = `${box.left + window.scrollX}px`;
        menu.style.visibility = '';
        // Focused, so the keyboard can reach it at all. Two frames later:
        // Crepe's handle, on the mouseup that follows this pointerup, waits one
        // frame and then focuses the editor, which would take it straight back.
        // preventScroll: the menu is already where it should be.
        const opened = menu;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (menu !== opened) return;
          opened.querySelector('.nib-block-menu-item')?.focus({ preventScroll: true });
        }));
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
        // Ctrl+/ (Cmd+/ on a Mac) opens the same menu for the block the cursor
        // is in. The dots only appear under a pointer, so without this the
        // menu - turning a block into another, duplicating it, deleting it -
        // could not be reached from the keyboard at all.
        if (openFromKeyboard(event)) return;
        if (event.key !== 'Escape' || !menu) return;
        // Escape on an open menu closes the menu and goes back to the writing,
        // rather than also stepping out of the note.
        event.stopPropagation();
        close();
        view.focus();
      };

      const openFromKeyboard = (event) => {
        const mod = event.ctrlKey || event.metaKey;
        if (!mod || event.shiftKey || event.altKey || event.key !== '/') return false;
        if (!view.hasFocus()) return false;
        const { from } = view.state.selection;
        const range = blockRangeAt(view.state.doc, from);
        if (!range) return false;
        event.preventDefault();
        event.stopPropagation();
        let at;
        try {
          at = view.coordsAtPos(range.from + 1);
        } catch {
          return false;
        }
        open({ top: at.top, bottom: at.bottom, left: at.left }, from);
        return true;
      };

      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('pointerup', onPointerUp, true);
      // Capture, so it runs before the app's own Escape handler on window.
      document.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('scroll', close, true);

      return {
        destroy: () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('pointerup', onPointerUp, true);
          document.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('scroll', close, true);
          close();
        },
      };
    },
  });
});
