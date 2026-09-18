import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from './autosave';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createAutosave', () => {
  it('saves once, after typing stops', async () => {
    const save = vi.fn();
    const auto = createAutosave({ delay: 800, save });
    auto.schedule('a');
    auto.schedule('ab');
    auto.schedule('abc');
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');
  });

  it('flushes a pending save immediately', async () => {
    const save = vi.fn();
    const auto = createAutosave({ delay: 800, save });
    auto.schedule('abc');
    await auto.flush();
    expect(save).toHaveBeenCalledWith('abc');

    // The timer must not fire a second save for the same text.
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flushes nothing when nothing is pending', async () => {
    const save = vi.fn();
    await createAutosave({ delay: 800, save }).flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('cancels a pending save', async () => {
    const save = vi.fn();
    const auto = createAutosave({ delay: 800, save });
    auto.schedule('abc');
    auto.cancel();
    await vi.advanceTimersByTimeAsync(800);
    expect(save).not.toHaveBeenCalled();
  });

  it('reports whether a save is waiting', () => {
    const auto = createAutosave({ delay: 800, save: vi.fn() });
    expect(auto.pending()).toBe(false);
    auto.schedule('abc');
    expect(auto.pending()).toBe(true);
    auto.cancel();
    expect(auto.pending()).toBe(false);
  });
});
