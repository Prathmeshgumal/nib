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
