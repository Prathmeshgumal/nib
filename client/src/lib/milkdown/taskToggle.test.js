import { afterEach, describe, expect, it } from 'vitest';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { createEditor } from './editorConfig';
import { labelTasks, taskAt, toggleTask } from './taskToggle';

let crepe;
let root;

async function open(markdown) {
  root = document.createElement('div');
  document.body.appendChild(root);
  crepe = createEditor(root, { markdown });
  await crepe.create();
  return crepe.editor.action((ctx) => ctx.get(editorViewCtx));
}

// Puts the cursor just inside the first text that contains `text`.
function cursorIn(view, text) {
  let at = null;
  view.state.doc.descendants((node, pos) => {
    if (at === null && node.isText && node.text.includes(text)) at = pos + node.text.indexOf(text) + 1;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

function press(view, init) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
  let handled = false;
  view.someProp('handleKeyDown', (f) => {
    if (f(view, event)) handled = true;
    return handled;
  });
  return handled;
}

afterEach(async () => {
  await crepe?.destroy();
  root?.remove();
  crepe = null;
});

describe('ticking a to-do from the keyboard', () => {
  it('Ctrl+Enter ticks the to-do the cursor is in, and unticks it again', async () => {
    const view = await open('- [ ] buy bread\n- [ ] pay rent\n');
    cursorIn(view, 'pay');
    expect(press(view, { ctrlKey: true })).toBe(true);
    expect(crepe.getMarkdown()).toContain('- [x] pay rent');
    expect(crepe.getMarkdown()).toContain('- [ ] buy bread');
    press(view, { ctrlKey: true });
    expect(crepe.getMarkdown()).toContain('- [ ] pay rent');
  });

  it('works with ⌘ as well', async () => {
    const view = await open('- [ ] buy bread\n');
    cursorIn(view, 'bread');
    press(view, { metaKey: true });
    expect(crepe.getMarkdown()).toContain('- [x] buy bread');
  });

  it('leaves a plain bullet and a paragraph alone', async () => {
    const view = await open('- a bullet\n\nA paragraph\n');
    cursorIn(view, 'bullet');
    expect(taskAt(view.state)).toBeNull();
    expect(press(view, { ctrlKey: true })).toBe(false);
    cursorIn(view, 'paragraph');
    expect(press(view, { ctrlKey: true })).toBe(false);
  });

  it('Enter on its own does not tick anything', async () => {
    const view = await open('- [ ] buy bread\n');
    cursorIn(view, 'bread');
    press(view, {});
    expect(crepe.getMarkdown()).not.toContain('[x]');
  });

  it('toggleTask refuses a position that is not a to-do', async () => {
    const view = await open('A paragraph\n');
    expect(toggleTask(view.state.tr, 0)).toBeNull();
  });
});

describe('the circle is a checkbox', () => {
  it('has a role, a state and a name', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="milkdown-list-item-block"><li><div class="label-wrapper"><span class="label unchecked"></span></div></li></div>
      <div class="milkdown-list-item-block"><li><div class="label-wrapper"><span class="label checked"></span></div></li></div>
      <div class="milkdown-list-item-block"><li><div class="label-wrapper"><span class="label bullet"></span></div></li></div>`;
    labelTasks(host);
    const [todo, done, bullet] = host.querySelectorAll('.label-wrapper');
    expect(todo.getAttribute('role')).toBe('checkbox');
    expect(todo.getAttribute('aria-checked')).toBe('false');
    expect(todo.tabIndex).toBe(0);
    expect(done.getAttribute('aria-checked')).toBe('true');
    expect(bullet.hasAttribute('role')).toBe(false);
  });
});
