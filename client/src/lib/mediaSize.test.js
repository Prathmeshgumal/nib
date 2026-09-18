import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_WIDTH, MIN_WIDTH, clampWidth, clearSize, setSize, sizeFor } from './mediaSize';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('clampWidth', () => {
  it('rounds to whole pixels', () => {
    expect(clampWidth(320.4)).toBe(320);
  });

  it('will not go below the floor', () => {
    expect(clampWidth(10)).toBe(MIN_WIDTH);
  });

  it('will not go above the ceiling', () => {
    expect(clampWidth(99999)).toBe(MAX_WIDTH);
  });

  it('keeps the media inside its container', () => {
    expect(clampWidth(900, 600)).toBe(600);
    expect(clampWidth(400, 600)).toBe(400);
  });

  it('ignores a container of unknown width', () => {
    expect(clampWidth(900, 0)).toBe(900);
  });

  it('refuses a width that is not a number', () => {
    expect(clampWidth(NaN)).toBe(null);
    expect(clampWidth(Infinity)).toBe(null);
    expect(clampWidth(undefined)).toBe(null);
  });
});

describe('remembering a size', () => {
  it('reads back what was stored', () => {
    setSize('abc.png', 420);
    expect(sizeFor('abc.png')).toBe(420);
  });

  it('has no size for an attachment never resized', () => {
    expect(sizeFor('abc.png')).toBe(null);
  });

  it('clamps on the way in, so a bad width cannot be stored', () => {
    setSize('abc.png', 5);
    expect(sizeFor('abc.png')).toBe(MIN_WIDTH);
  });

  it('keeps each attachment separate', () => {
    setSize('one.png', 300);
    setSize('two.png', 500);
    expect([sizeFor('one.png'), sizeFor('two.png')]).toEqual([300, 500]);
  });

  it('forgets a size on clear', () => {
    setSize('abc.png', 420);
    clearSize('abc.png');
    expect(sizeFor('abc.png')).toBe(null);
  });

  it('ignores a stored value that is not a width', () => {
    window.localStorage.setItem('nib.size.abc.png', 'wide');
    expect(sizeFor('abc.png')).toBe(null);
  });

  it('does nothing without a name', () => {
    expect(sizeFor('')).toBe(null);
    expect(() => setSize('', 300)).not.toThrow();
    expect(() => clearSize('')).not.toThrow();
  });
});

// A private window, blocked site data or a full store: every one of these
// throws, and none of them is worth an error to someone reading a note.
describe('when storage is unavailable', () => {
  it('reports no size rather than throwing', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(sizeFor('abc.png')).toBe(null);
  });

  it('swallows a failed write', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => setSize('abc.png', 300)).not.toThrow();
  });

  it('swallows a failed clear', () => {
    vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => clearSize('abc.png')).not.toThrow();
  });
});
