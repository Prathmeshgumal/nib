import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

// Ticking a to-do without a mouse. Crepe draws the circle as a bare span that
// listens for a pointer and nothing else, so from the keyboard a to-do could
// be written but never done.
//
// Two ways in: Ctrl+Enter (⌘+Enter on a Mac) ticks the to-do the cursor is in,
// the way Notion and most editors do it; and the circle itself is a real
// checkbox - focusable, named, and toggled by Space or Enter.

export const taskToggleKey = new PluginKey('nibTaskToggle');

// The to-do the cursor sits in: the nearest list item that is a task. A plain
// bullet (checked === null) does not count, and neither does one further out,
// so the shortcut never ticks a parent the cursor is not on.
export function taskAt(state) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'list_item') {
      return node.attrs.checked === null || node.attrs.checked === undefined
        ? null
        : { node, pos: $from.before(depth) };
    }
  }
  return null;
}

export function toggleTask(tr, pos) {
  const node = tr.doc.nodeAt(pos);
  if (!node || node.attrs.checked == null) return null;
  return tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked });
}

// Where the list item drawn by `dom` starts in the document.
function itemPos(view, dom) {
  let found = null;
  view.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === 'list_item') {
      const drawn = view.nodeDOM(pos);
      if (drawn && (drawn === dom || drawn.contains(dom))) {
        // Keep looking inside it: a nested to-do is drawn inside its parent.
        found = pos;
        let inner = null;
        node.descendants((child, offset) => {
          if (child.type.name !== 'list_item') return true;
          const at = pos + 1 + offset;
          const d = view.nodeDOM(at);
          if (d && (d === dom || d.contains(dom))) inner = at;
          return true;
        });
        if (inner !== null) found = inner;
      }
    }
    return true;
  });
  return found;
}

// Gives each to-do circle the role, name and state a checkbox has.
export function labelTasks(root) {
  root.querySelectorAll('.milkdown-list-item-block .label-wrapper').forEach((label) => {
    const checked = label.querySelector('.checked');
    const unchecked = label.querySelector('.unchecked');
    if (!checked && !unchecked) {
      if (label.getAttribute('role') === 'checkbox') {
        label.removeAttribute('role');
        label.removeAttribute('tabindex');
        label.removeAttribute('aria-checked');
        label.removeAttribute('aria-label');
      }
      return;
    }
    const state = checked ? 'true' : 'false';
    if (label.getAttribute('aria-checked') === state) return;
    label.setAttribute('role', 'checkbox');
    label.setAttribute('tabindex', '0');
    label.setAttribute('aria-checked', state);
    label.setAttribute('aria-label', checked ? 'Done' : 'To do');
    label.title = checked ? 'Mark as not done (Ctrl+Enter)' : 'Mark as done (Ctrl+Enter)';
  });
}

export const taskToggle = $prose(() => new Plugin({
  key: taskToggleKey,
  props: {
    handleKeyDown(view, event) {
      // Ctrl/⌘+Enter in the text of a to-do.
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) {
        return false;
      }
      const task = taskAt(view.state);
      if (!task) return false;
      view.dispatch(toggleTask(view.state.tr, task.pos));
      return true;
    },
  },
  view: (view) => {
    const sync = () => {
      const root = view.dom.closest('.milkdown') ?? view.dom;
      labelTasks(root);
    };
    // Space or Enter on a focused circle. Listened for directly: the circle
    // sits in a part of the note ProseMirror leaves to the node view, so its
    // own key handling never sees it.
    const onKey = (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      const target = event.target;
      if (!(target instanceof Element) || !target.matches('.label-wrapper[role=checkbox]')) return;
      const pos = itemPos(view, target.closest('.milkdown-list-item-block') ?? target);
      if (pos === null) return;
      const tr = toggleTask(view.state.tr, pos);
      if (!tr) return;
      event.preventDefault();
      event.stopPropagation();
      view.dispatch(tr);
      // Redrawing the item replaces the circle, so focus goes to the new one.
      requestAnimationFrame(() => {
        const block = view.nodeDOM(pos);
        const label = block instanceof Element ? block.querySelector('.label-wrapper') : null;
        if (label) {
          labelTasks(view.dom.closest('.milkdown') ?? view.dom);
          label.focus();
        }
      });
    };
    view.dom.addEventListener('keydown', onKey, true);
    // The circles are drawn after the document, by Vue.
    let frame = requestAnimationFrame(sync);
    return {
      update: () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(sync);
      },
      destroy: () => {
        cancelAnimationFrame(frame);
        view.dom.removeEventListener('keydown', onKey, true);
      },
    };
  },
}));
