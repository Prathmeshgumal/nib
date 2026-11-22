import { $prose } from '@milkdown/kit/utils';
import { NodeSelection, Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { storedName } from '@/lib/attachments';
import { isExpanded, setExpanded } from '@/lib/expandedImages';

// Images as chips. A prompt with three screenshots read as three walls of
// picture with a sentence squeezed between each; as chips - a thumbnail and
// "Image 1" sitting in the line - it reads as the sentence it is, and the same
// "Image N" is what copying writes beside each image's path.
//
// Everything here is decoration, the way imageResize.js adds its grip: the
// document and the markdown never learn about chips, so nothing here can
// change what a note says. Opening and closing one is a view change, not an
// edit - it adds no undo step and does not mark the note as changed.

export const imageChipsKey = new PluginKey('nibImageChips');

const IMAGE_NODES = new Set(['image', 'image-block']);

// Every attached image in the note, in reading order, numbered from 1. Each
// occurrence counts, so the same picture used twice is two chips.
export function attachedImages(doc) {
  const found = [];
  doc.descendants((node, pos) => {
    if (!IMAGE_NODES.has(node.type.name)) return true;
    const name = storedName(node.attrs?.src);
    if (name) found.push({ pos, node, name, number: found.length + 1 });
    return false;
  });
  return found;
}

const EXPAND_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

function redraw(view) {
  view.dispatch(view.state.tr.setMeta(imageChipsKey, 'redraw').setMeta('addToHistory', false));
}

// Acts on pointerdown, not click: by click time the editor has already moved
// the selection onto the image, which is not what pressing a chip means.
function onPress(el, act) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    act(e);
  });
  // Enter and Space for a keyboard, which never sends a pointerdown.
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    act(e);
  });
}

// Shift on a chip selects its image instead of opening it, so it can be
// copied on its own - as the picture itself (see copyPaths.js).
function select(view, getPos) {
  const pos = getPos();
  if (typeof pos !== 'number') return;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  view.focus();
}

function chip(view, { node, name, number }, getPos, selected) {
  const button = document.createElement('button');
  button.type = 'button';
  // A selected image is hidden behind its chip, so the chip shows it: typing
  // would replace the image, and Ctrl+C copies the picture.
  button.className = selected ? 'nib-image-chip nib-image-chip-selected' : 'nib-image-chip';
  button.contentEditable = 'false';
  button.setAttribute('aria-label', `Image ${number}, show full image`);
  button.title = 'Show the full image (Shift+click selects it, to copy the picture)';
  const thumb = document.createElement('img');
  thumb.className = 'nib-image-chip-thumb';
  thumb.src = node.attrs.src;
  thumb.alt = '';
  const label = document.createElement('span');
  label.textContent = `Image ${number}`;
  button.append(thumb, label);
  onPress(button, (e) => {
    if (e.shiftKey) return select(view, getPos);
    setExpanded(name, true);
    redraw(view);
  });
  return button;
}

function collapse(view, { name, number }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nib-image-collapse';
  button.contentEditable = 'false';
  button.setAttribute('aria-label', `Collapse image ${number} to a chip`);
  button.title = 'Collapse to a chip';
  button.innerHTML = EXPAND_ICON;
  onPress(button, () => {
    setExpanded(name, false);
    redraw(view);
  });
  return button;
}

function decorate(view, state) {
  const { doc, selection } = state;
  const decorations = [];
  for (const image of attachedImages(doc)) {
    const { pos, node, name, number } = image;
    const block = node.type.name === 'image-block';
    if (isExpanded(name)) {
      decorations.push(
        Decoration.widget(pos, () => collapse(view, image), {
          side: -1,
          key: `collapse-${number}-${name}`,
          ignoreSelection: true,
        }),
      );
    } else {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'nib-image-collapsed' }));
      // A block image's chip sits on its own line; an inline one in the text.
      const selected = selection instanceof NodeSelection && selection.from === pos;
      decorations.push(
        Decoration.widget(pos, (_view, getPos) => chip(view, image, getPos, selected), {
          side: -1,
          key: `chip-${number}-${name}-${block ? 'b' : 'i'}${selected ? '-s' : ''}`,
          ignoreSelection: true,
        }),
      );
    }
  }
  return DecorationSet.create(doc, decorations);
}

export const imageChips = $prose(() => {
  let view = null;
  return new Plugin({
    key: imageChipsKey,
    view: (v) => {
      view = v;
      // The first draw happened before the view existed to be handed to the
      // buttons, so draw once more now that it does.
      queueMicrotask(() => {
        if (view && !view.isDestroyed) redraw(view);
      });
      return { destroy: () => (view = null) };
    },
    props: {
      decorations(state) {
        return view ? decorate(view, state) : DecorationSet.empty;
      },
    },
  });
});
