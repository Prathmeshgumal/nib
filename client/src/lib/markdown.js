import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { blockSpans, stampTargets } from '@/lib/sourceMap';
import { isViewable, kindOf, rawHref, storedName, viewerHref } from '@/lib/attachments';
import { sizeFor } from '@/lib/mediaSize';

marked.setOptions({ gfm: true, breaks: true });

// player builds the whole of what replaces a media link: the player, and under
// it the filename it came from.
//
// The caption is not decoration. A player on its own is anonymous, so the
// nearest link above it reads as its label - which is how a note holding a
// .docx link, a clip, a .pdf link and a recording ends up looking as though
// every name sits against the wrong file. The name belongs to the player.
//
// Everything here is phrasing content - spans, not <figure> - because the
// replacement happens inside a <p>. This tree is serialized to a string and
// re-parsed by the caller, and a block element inside a paragraph would be
// torn out of it on that second parse, taking the paragraph's stamped source
// offset with it.
function player(kind, name, label) {
  const box = document.createElement('span');
  box.className = `nib-media nib-media-${kind}`;

  const el = document.createElement(kind);
  el.setAttribute('controls', '');
  // Enough to draw the timeline and a first frame without pulling the whole
  // file down for a note that is only being skimmed.
  el.setAttribute('preload', 'metadata');
  el.setAttribute('src', rawHref(name));
  el.className = kind === 'video' ? 'nib-video' : 'nib-audio';

  const caption = document.createElement('span');
  // `not-prose` is how the typography plugin is told to keep its hands off a
  // subtree. Without it the caption's link is styled as prose body copy - the
  // plugin's rules sit in the utilities layer, which wins over ours whatever
  // the selector, so there is nothing to out-specify.
  caption.className = 'nib-caption not-prose';
  // The caption is also how you get the file itself, since the link that used
  // to offer that is now a player.
  const save = document.createElement('a');
  save.setAttribute('href', rawHref(name));
  save.setAttribute('download', label || name);
  save.textContent = label || name;
  caption.append(save);

  box.append(el, caption);
  // A video has a picture worth sizing to taste. An audio player is a row of
  // controls at a fixed height, so dragging it wider would do nothing useful.
  if (kind === 'video') resizable(box, el, name);
  return box;
}

// resizable gives a wrapper a corner to drag, and applies the width the reader
// last chose for that file.
//
// The width goes on the media itself rather than the wrapper, which then hugs
// whatever size the media is. Sizing the wrapper instead would mean the
// picture's width depends on the box and the box's width depends on the
// picture, and an unsized image has no way out of that.
//
// The stored width is not clamped here: what it has to fit inside is the
// rendered column, which does not exist yet at this point. The CSS caps it at
// the column's width, and a drag clamps against the real measurement.
function resizable(box, media, name) {
  box.dataset.file = name;
  media.classList.add('nib-sizable');

  const width = sizeFor(name);
  if (width !== null) media.style.width = `${width}px`;

  const grip = document.createElement('span');
  grip.className = 'nib-grip not-prose';
  // The drag is a pointer gesture with no text in it, so there is nothing here
  // for a screen reader to announce and nothing to put in the tab order.
  grip.setAttribute('aria-hidden', 'true');
  box.append(grip);
}

// upgradeAttachments turns the plain links the note stores into whatever the
// browser can actually do with each file.
//
// It runs on the sanitized tree rather than on the markdown, so the note on
// disk never changes: the terminal keeps reading the same
// `[name](attachments/abc.mp4)` it wrote. Only this page knows the difference.
//
// It also runs after the source offsets are stamped. Swapping a link for a
// player replaces an inline node inside a block, never a block itself, so the
// stamped elements stay exactly as the offset walk counted them.
function upgradeAttachments(host) {
  // An image already draws itself; all it wants is a corner to drag. The
  // wrapper is the same one the players use, minus the caption: an image's
  // alt text already names it, and adding one would change how every note
  // that has ever held a picture looks.
  for (const img of host.querySelectorAll('img[src]')) {
    const name = storedName(img.getAttribute('src'));
    if (!name) continue; // a picture from somewhere else on the web
    const box = document.createElement('span');
    box.className = 'nib-media nib-media-image';
    img.replaceWith(box);
    box.append(img);
    resizable(box, img, name);
  }

  for (const link of host.querySelectorAll('a[href]')) {
    const name = storedName(link.getAttribute('href'));
    if (!name) continue; // an ordinary link in the prose
    const kind = kindOf(name);

    // Media plays where it sits. Sending the reader to another tab to watch a
    // clip they attached to a paragraph is a step backwards from a link.
    if (kind === 'video' || kind === 'audio') {
      link.replaceWith(player(kind, name, link.textContent.trim()));
      continue;
    }

    // Everything the viewer can render opens there, in its own tab.
    if (isViewable(name)) {
      // The link text is the filename the reader chose; the name on disk is
      // a hash. Carry the readable one across so the tab has a title.
      link.setAttribute('href', viewerHref(name, link.textContent.trim()));
    } else if (kind !== 'pdf') {
      // A type with nothing to show: the link keeps downloading, as before,
      // and a download does not navigate, so it needs no target.
      continue;
    }
    // The PDF falls through to here: Chrome's own viewer is better than
    // anything worth building, so the href stays raw and only the target
    // changes - a plain click should not throw away the note being read.
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
}

// Note content is user-authored markdown; sanitize before it touches the DOM.
// The offsets are stamped after sanitizing, so they are ours rather than
// something the sanitizer had to be persuaded to keep.
export function renderMarkdown(src) {
  const clean = DOMPurify.sanitize(marked.parse(src || ''), {
    ADD_ATTR: ['target', 'rel'],
  });
  const host = document.createElement('div');
  host.innerHTML = clean;

  const spans = blockSpans(src);
  const targets = stampTargets(host);
  // A wrong offset sends the cursor to the wrong line, which is worse than no
  // click-to-edit at all. If the two walks ever disagree, stamp nothing - and
  // leave the checkboxes disabled with it, since ticking one needs an offset.
  if (targets.length === spans.length) {
    targets.forEach((el, i) => el.setAttribute('data-src', String(spans[i].start)));

    // marked renders task checkboxes disabled, which swallows the click. A
    // reader should be able to tick a box without opening the editor at all —
    // something the terminal cannot offer.
    for (const box of host.querySelectorAll('input[type="checkbox"]')) {
      box.removeAttribute('disabled');
      box.classList.add('nib-task');
    }
  }

  upgradeAttachments(host);
  return host.innerHTML;
}
