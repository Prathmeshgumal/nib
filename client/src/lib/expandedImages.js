// Which images the reader has opened out of their chip.
//
// Like the sizes in mediaSize.js, this is a per-reader convenience and never
// reaches the note. The key is the attachment's stored name - a hash of its
// contents - so a picture opened once is open wherever it appears.

const PREFIX = 'nib.expanded.';

export function isExpanded(name) {
  if (!name) return false;
  try {
    return window.localStorage.getItem(PREFIX + name) === '1';
  } catch {
    return false;
  }
}

export function setExpanded(name, open) {
  if (!name) return;
  try {
    if (open) window.localStorage.setItem(PREFIX + name, '1');
    else window.localStorage.removeItem(PREFIX + name);
  } catch {
    // Blocked storage costs the memory of this choice, not the choice itself.
  }
}
