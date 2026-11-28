import { Selection } from '@milkdown/kit/prose/state';

// Notes are mostly added to at the bottom, so a note opens there with the
// cursor after the last word, rather than at the top with a scroll to do
// before the first keystroke (issue #60).
//
// The cursor only takes focus where there is a physical keyboard's worth of
// screen. On a phone, focusing would throw the on-screen keyboard over the
// note the moment it is opened just to be read; there it is scrolled to the
// end and left for a tap.
export const WIDE = '(min-width: 768px)';

export function wideScreen() {
  try {
    return window.matchMedia(WIDE).matches;
  } catch {
    return false;
  }
}

export function cursorToEnd(view, { focus = false } = {}) {
  const { state } = view;
  view.dispatch(state.tr.setSelection(Selection.atEnd(state.doc)));
  if (focus) view.focus();
}

// Images and videos load after the text, each pushing the bottom further
// down, so the scroll follows them until the writer does something of their
// own - scrolls, clicks, types - or a few seconds have passed.
export function scrollToEnd(scroller, { follow = 3000 } = {}) {
  const toEnd = () => {
    scroller.scrollTop = scroller.scrollHeight;
  };
  toEnd();
  requestAnimationFrame(toEnd);

  const userEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  let timer = null;
  const stop = () => {
    clearTimeout(timer);
    scroller.removeEventListener('load', toEnd, true);
    for (const type of userEvents) scroller.removeEventListener(type, stop, true);
  };
  scroller.addEventListener('load', toEnd, true);
  for (const type of userEvents) scroller.addEventListener(type, stop, true);
  timer = setTimeout(stop, follow);
  return stop;
}
