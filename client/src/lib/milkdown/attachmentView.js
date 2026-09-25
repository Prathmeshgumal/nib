import { isViewable, kindOf, rawHref, storedName, viewerHref } from '@/lib/attachments';
import { applyStoredWidth, makeGrip } from './resize';

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
    if (kind === 'video') {
      applyStoredWidth(el, name);
      box.append(makeGrip(name, (grip) => grip.parentElement?.querySelector('.nib-sizable')));
    }
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

