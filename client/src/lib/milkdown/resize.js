import { clampWidth, clearSize, setSize, sizeFor } from '@/lib/mediaSize';

// Dragging a corner to resize, shared by the attachment node's video player
// and by the images Milkdown's own nodes draw.
//
// Nothing here touches the note. The width lives in local storage keyed by the
// file's name on disk, so the markdown the terminal reads never learns that a
// picture was resized - which is also why it survives the note being edited
// from the other side.

// applyStoredWidth puts back the width the reader last chose for this file.
//
// It is not clamped here: what it has to fit inside is the rendered column,
// which may not be laid out yet. The CSS caps it, and a drag clamps against a
// real measurement.
export function applyStoredWidth(media, name) {
  const width = sizeFor(name);
  if (width !== null) media.style.width = `${width}px`;
}

// makeGrip builds the corner. `find` is how the grip reaches the thing it
// resizes, called at drag time rather than captured, because a decoration's
// widget can outlive the element it was drawn beside.
export function makeGrip(name, find) {
  const grip = document.createElement('span');
  grip.className = 'nib-grip not-prose';
  // A pointer gesture with no text in it: nothing to announce, nothing to put
  // in the tab order.
  grip.setAttribute('aria-hidden', 'true');
  // The grip sits inside an editable document. Without this the editor treats
  // the drag as a text selection and the caret lands in the middle of it.
  grip.contentEditable = 'false';

  grip.addEventListener('pointerdown', (e) => {
    const media = find(grip);
    if (media) startResize(e, grip, media, name);
  });
  grip.addEventListener('dblclick', (e) => {
    // The way out of a drag that went too far.
    e.preventDefault();
    e.stopPropagation();
    find(grip)?.style.removeProperty('width');
    clearSize(name);
  });

  return grip;
}

function startResize(e, grip, media, name) {
  // A click here would otherwise open the editor, and a drag would select text
  // across the whole note.
  e.preventDefault();
  e.stopPropagation();

  const startX = e.clientX;
  const startWidth = media.getBoundingClientRect().width;
  // What the media has to fit inside, measured once: it cannot change while a
  // pointer is down, and reading it per frame would be a layout on every move.
  const limit = grip.closest('.ProseMirror, article, div')?.clientWidth ?? 0;

  const move = (ev) => {
    const width = clampWidth(startWidth + (ev.clientX - startX), limit);
    if (width !== null) media.style.width = `${width}px`;
  };
  const end = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', end);
    grip.removeEventListener('pointercancel', end);
    document.body.classList.remove('nib-resizing');
    setSize(name, media.getBoundingClientRect().width);
  };

  // jsdom has no pointer capture; the listeners below work without it.
  grip.setPointerCapture?.(e.pointerId);
  // While dragging, the whole page shows the resize cursor: the pointer is
  // long gone from the grip, and a cursor flickering over whatever is
  // underneath makes the drag feel broken.
  document.body.classList.add('nib-resizing');
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}
