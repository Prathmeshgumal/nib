// How wide the reader has made one attachment.
//
// This is the only thing here that touches storage, and it is deliberately the
// one kind of state browser storage is right for: a per-reader convenience.
// The note itself never learns about it, so the markdown stays portable and
// the terminal preview stays clean.
//
// The key is the attachment's stored name, which is a hash of its contents, so
// a file sized once is that size in every note it appears in.

const PREFIX = 'nib.size.';

// Below this a video loses its controls and an image says nothing; above it a
// drag has clearly been abandoned rather than aimed.
export const MIN_WIDTH = 120;
export const MAX_WIDTH = 4000;

// clampWidth keeps a width usable. The container matters as much as the
// stored number: a width saved on a wide monitor would otherwise overflow a
// laptop, and the reader would have to drag it back on every machine.
export function clampWidth(width, containerWidth = 0) {
  if (!Number.isFinite(width)) return null;
  const ceiling = containerWidth > 0 ? Math.min(MAX_WIDTH, containerWidth) : MAX_WIDTH;
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, ceiling)));
}

// sizeFor returns the width stored for an attachment, or null when there is
// none. Storage can be absent, disabled or full, and none of that is worth an
// error to the reader: it just means the media is its normal size.
export function sizeFor(name) {
  if (!name) return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + name);
    if (raw === null) return null;
    const width = Number(raw);
    return Number.isFinite(width) && width > 0 ? width : null;
  } catch {
    return null;
  }
}

export function setSize(name, width) {
  if (!name) return;
  const clean = clampWidth(width);
  if (clean === null) return;
  try {
    window.localStorage.setItem(PREFIX + name, String(clean));
  } catch {
    // A full or blocked store costs the reader the memory of this drag, not
    // the drag itself: the element is already the size they dropped it at.
  }
}

// clearSize puts an attachment back to its natural size, which is what double
// clicking the grip does.
export function clearSize(name) {
  if (!name) return;
  try {
    window.localStorage.removeItem(PREFIX + name);
  } catch {
    // Nothing to undo if it was never written.
  }
}
