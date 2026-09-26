// jsdom ships neither observer, and Milkdown's components construct both while
// mounting. Real browsers have had them for years, so these exist to let the
// editor start under the test runner, not to simulate anything.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

globalThis.IntersectionObserver ??= NoopObserver;
globalThis.ResizeObserver ??= NoopObserver;

// jsdom has MouseEvent but not PointerEvent, and the resize grip is driven by
// pointer events so that one gesture covers mouse, pen and touch.
if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent = class PointerEvent extends globalThis.MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'mouse';
    }
  };
}

// jsdom has no layout, so it has no elementFromPoint. Milkdown's drag handle
// calls it on every pointer move to find the block under the cursor; without
// this the resize tests throw from inside a debounce, where nothing can catch
// it. Nothing is under the pointer in a document with no boxes, so null is the
// honest answer.
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null;
}

// Same story for Range: jsdom implements the DOM Range API but not the two
// methods that ask where it is on screen, because it has no screen. Milkdown
// ships prosemirror-virtual-cursor, which measures the caret on every dispatch
// - so without these, merely moving the selection in a test throws from inside
// a plugin view, which is nowhere a test can catch it. An empty list and a
// zero rect are what a document with no layout honestly measures.
const EMPTY_RECT = {
  x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
  toJSON() { return this; },
};
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null });
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ ...EMPTY_RECT });
}
