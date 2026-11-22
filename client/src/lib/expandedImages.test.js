import { afterEach, describe, expect, it, vi } from 'vitest';
import { isExpanded, setExpanded } from './expandedImages';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('which images are left open', () => {
  it('starts collapsed', () => {
    expect(isExpanded('a.png')).toBe(false);
  });

  it('remembers opening and closing', () => {
    setExpanded('a.png', true);
    expect(isExpanded('a.png')).toBe(true);
    setExpanded('a.png', false);
    expect(isExpanded('a.png')).toBe(false);
    expect(localStorage.getItem('nib.expanded.a.png')).toBeNull();
  });

  it('treats storage that throws as collapsed', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(isExpanded('a.png')).toBe(false);
  });
});
