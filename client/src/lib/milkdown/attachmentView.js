import { isViewable, kindOf, rawHref, storedName, viewerHref } from '@/lib/attachments';
import { clampWidth, clearSize, setSize, sizeFor } from '@/lib/mediaSize';

// renderAttachment builds the whole of what an attachment link becomes on the
// page. It is a pure DOM builder, separate from the ProseMirror node view, so
// what each kind draws can be tested without standing up an editor.
//
// This is a port of upgradeAttachments in lib/markdown.js, which did the same
// job against the rendered read view. The behaviour is deliberately the same:
// a file that played in the note before still plays in the note now.
export function renderAttachment({ src, text }) {
  const name = storedName(src);
  const label = (text || '').trim() || name || src;
  const kind = name ? kindOf(name) : 'file';

  const box = document.createElement('span');
  box.className = `nib-media nib-media-${kind}`;
  box.setAttribute('data-type', 'nib-attachment');
  if (name) box.dataset.file = name;

  // Not an attachment after all - render the plain link rather than invent a
  // box around something this code does not own.
  if (!name) {
    box.append(anchor(src, label, { target: true }));
    return box;
  }

  // Media plays where it sits. Sending the reader to another tab to watch a
  // clip they attached to a paragraph is a step backwards from a link.
  if (kind === 'video' || kind === 'audio') {
    const el = document.createElement(kind);
    el.setAttribute('controls', '');
    // Enough to draw the timeline and a first frame without pulling the whole
    // file down for a note that is only being skimmed.
    el.setAttribute('preload', 'metadata');
    el.setAttribute('src', rawHref(name));
    el.className = kind === 'video' ? 'nib-video' : 'nib-audio';
    if (kind === 'video') el.classList.add('nib-sizable');
    box.append(el, caption(name, label));
    // A video has a picture worth sizing to taste. An audio player is a row of
    // controls at a fixed height, so dragging it wider would do nothing.
    if (kind === 'video') resizable(box, el, name);
    return box;
  }

  // The viewer tab can render these, and the readable name travels with the
  // href because the name on disk is a hash and the tab needs a title.
  if (isViewable(name)) {
    box.append(anchor(viewerHref(name, label), label, { target: true }));
    return box;
  }

  // Chrome's own PDF viewer beats anything worth building here, so the href
  // stays raw and only the target changes: a click should not throw away the
  // note being read.
  if (kind === 'pdf') {
    box.append(anchor(rawHref(name), label, { target: true }));
    return box;
  }

  // Nothing useful to show: the link downloads, as it always did, and a
  // download does not navigate, so it needs no target.
  box.append(anchor(rawHref(name), label, { download: label }));
  return box;
}

function anchor(href, label, { target = false, download = null } = {}) {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  if (target) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  if (download) a.setAttribute('download', download);
  a.textContent = label;
  return a;
}

// The caption is not decoration: it names the player, and it is also how the
// file itself is still reachable now that the link has become one.
function caption(name, label) {
  const span = document.createElement('span');
  span.className = 'nib-caption not-prose';
  span.append(anchor(rawHref(name), label, { download: label }));
  return span;
}

// resizable gives a box a corner to drag, and applies the width the reader
// last chose for that file.
//
// The width goes on the media rather than the box, which then hugs whatever
// size the media is. Sizing the box instead would mean the picture's width
// depends on the box and the box's width depends on the picture.
//
// Nothing here touches the note: the width lives in local storage, so the
// markdown the terminal reads never learns that a video was resized.
function resizable(box, media, name) {
  const stored = sizeFor(name);
  // Not clamped here: what it has to fit inside is the rendered column, which
  // does not exist yet. The CSS caps it, and a drag clamps against the real
  // measurement.
  if (stored !== null) media.style.width = `${stored}px`;

  const grip = document.createElement('span');
  grip.className = 'nib-grip not-prose';
  // A pointer gesture with no text in it: nothing to announce, nothing to put
  // in the tab order.
  grip.setAttribute('aria-hidden', 'true');
  // The grip sits inside an editable document. Without this the editor treats
  // the drag as a text selection and the caret lands in the middle of it.
  grip.contentEditable = 'false';

  grip.addEventListener('pointerdown', (e) => startResize(e, grip, media, name));
  grip.addEventListener('dblclick', (e) => {
    // The way out of a drag that went too far.
    e.preventDefault();
    e.stopPropagation();
    media.style.removeProperty('width');
    clearSize(name);
  });

  box.append(grip);
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
