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
