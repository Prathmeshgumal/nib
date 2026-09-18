import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { blockSpans, stampTargets } from '@/lib/sourceMap';

marked.setOptions({ gfm: true, breaks: true });

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
  // click-to-edit at all. If the two walks ever disagree, stamp nothing.
  if (targets.length !== spans.length) return clean;
  targets.forEach((el, i) => el.setAttribute('data-src', String(spans[i].start)));

  // marked renders task checkboxes disabled, which swallows the click. A
  // reader should be able to tick a box without opening the editor at all —
  // something the terminal cannot offer.
  for (const box of host.querySelectorAll('input[type="checkbox"]')) {
    box.removeAttribute('disabled');
    box.classList.add('nib-task');
  }
  return host.innerHTML;
}
