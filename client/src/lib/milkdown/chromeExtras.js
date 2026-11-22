// The small things Crepe's floating controls leave out: names for buttons
// that are only icons, a Copy button that says it copied, links that open
// somewhere sensible, and a hint that the phone toolbar has more in it.
// editorChrome.js calls these each time Crepe redraws its controls.

// --- Names ---------------------------------------------------------------

function name(el, label) {
  if (!el || el.getAttribute('aria-label') === label) return;
  el.setAttribute('aria-label', label);
  el.title = label;
}

// Copy, edit and remove beside a link were three unnamed icons.
export function labelLinkPreview(root) {
  const preview = root.querySelector('.milkdown-link-preview');
  if (!preview) return;
  const copy = preview.querySelector('.link-icon');
  name(copy, 'Copy link');
  name(preview.querySelector('.link-edit-button'), 'Edit link');
  name(preview.querySelector('.link-remove-button'), 'Remove link');
  name(preview.querySelector('.link-display'), 'Open link in a new tab');
  for (const el of preview.querySelectorAll('.button')) el.setAttribute('role', 'button');
}

const COLUMN_BUTTONS = ['Align column left', 'Align column centre', 'Align column right', 'Delete column'];

// The table's handles and the buttons they open.
export function labelTables(root) {
  for (const table of root.querySelectorAll('.milkdown-table-block')) {
    const col = table.querySelector('[data-role=col-drag-handle]');
    const row = table.querySelector('[data-role=row-drag-handle]');
    name(col, 'Column: click for options, drag to move');
    name(row, 'Row: click for options, drag to move');
    col?.querySelectorAll('.button-group button').forEach((b, i) => name(b, COLUMN_BUTTONS[i]));
    row?.querySelectorAll('.button-group button').forEach((b) => name(b, 'Delete row'));
    name(table.querySelector('[data-role=x-line-drag-handle] .add-button'), 'Add a row here');
    name(table.querySelector('[data-role=y-line-drag-handle] .add-button'), 'Add a column here');
  }
}

// The one button over an image, for its caption, was an unnamed icon.
export function labelImages(root) {
  for (const item of root.querySelectorAll('.milkdown-image-block .operation .operation-item')) {
    item.setAttribute('role', 'button');
    name(item, 'Add or hide a caption');
  }
  for (const handle of root.querySelectorAll('.milkdown-image-block .image-resize-handle')) {
    if (!handle.title) handle.title = 'Drag to resize';
  }
}

// "Text" on its own read as a label, not as something to change.
export function labelCodeBlocks(root) {
  for (const button of root.querySelectorAll('.milkdown-code-block .language-button')) {
    if (button.title) continue;
    button.title = 'Choose the language';
    button.setAttribute('aria-haspopup', 'listbox');
  }
}

// --- Links ---------------------------------------------------------------

// What a link points at, as something a browser can open. "example.com" typed
// into the link box is a website to the typist and a file next to this page to
// the browser, which opened nib's own address with /example.com on the end.
export function openableHref(href) {
  const raw = (href ?? '').trim();
  if (!raw) return null;
  // Anything that can run script is not opened at all.
  if (/^\s*(javascript|data|vbscript):/i.test(raw)) return null;
  // https://, ftp://, mailto:, tel: - but not "example.com:8080", which only
  // looks like it starts with a scheme.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(mailto|tel|sms):/i.test(raw)) return raw;
  if (/^(\/|#|\.\/|\.\.\/|attachments\/)/.test(raw)) return raw; // within nib
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(raw)) return `mailto:${raw}`;
  if (/^[^\s/]+\.[^\s/]{2,}(\/|$|\?|#|:)/.test(raw)) return `https://${raw}`;
  return raw;
}

export function openLink(href) {
  const url = openableHref(href);
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

// --- Copying code --------------------------------------------------------

export async function writeClipboard(text) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Over plain http from another machine there is no clipboard API, and a
    // browser can refuse it; the old way still works in both.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    const focused = document.activeElement;
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    focused?.focus?.();
    return ok;
  }
}

const flashes = new WeakMap();

// Shows the result on the button itself for a moment - "Copied", or "Couldn't
// copy" - which is where the eye already is. The words are drawn by CSS from
// data-copied, so Vue's own rendering of the button is never touched.
export function flashCopied(button, ok) {
  clearTimeout(flashes.get(button));
  button.dataset.copied = ok ? 'yes' : 'no';
  button.setAttribute('aria-label', ok ? 'Copied' : "Couldn't copy");
  flashes.set(
    button,
    setTimeout(() => {
      delete button.dataset.copied;
      button.removeAttribute('aria-label');
    }, 1600)
  );
}

// The code in the block that `button` belongs to, read from the document
// rather than the screen, so wrapped and scrolled-away lines all come along.
export function codeFor(view, button) {
  const block = button.closest('.milkdown-code-block');
  if (!block) return null;
  let text = null;
  view.state.doc.descendants((node, pos) => {
    if (text !== null) return false;
    if (node.type.name === 'code_block') {
      const dom = view.nodeDOM(pos);
      if (dom && (dom === block || dom.contains(block) || block.contains(dom))) text = node.textContent;
      return false;
    }
    return true;
  });
  return text;
}

export async function copyCode(view, button) {
  const text = codeFor(view, button);
  if (text === null) return;
  flashCopied(button, await writeClipboard(text));
}

// --- The phone toolbar -----------------------------------------------------

// On a phone the bar scrolls sideways, and nothing said so: the buttons past
// the edge simply were not there. Each end fades out while there is more
// beyond it.
export function markOverflow(strip) {
  if (!strip) return;
  const left = strip.scrollLeft > 1;
  const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
  const value = [left && 'left', right && 'right'].filter(Boolean).join(' ');
  if ((strip.dataset.more ?? '') === value) return;
  if (value) strip.dataset.more = value;
  else delete strip.dataset.more;
}

// --- Placing the link preview ----------------------------------------------

// Crepe puts the preview flush on top of the link, over the line above it.
// It goes a little below the link instead, clear of the text being pointed at
// and of whatever heading sits above.
//
// Returns the new `top`, or null when it can stay where it is.
export function belowLink(box, linkRect, gap = 4) {
  if (!box || !linkRect) return null;
  const a = box.getBoundingClientRect();
  if (a.bottom - a.top <= 0) return null;
  const want = linkRect.bottom + gap;
  if (Math.abs(a.top - want) < 1) return null;
  return (parseFloat(box.style.top) || 0) + (want - a.top);
}
