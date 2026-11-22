import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = { copyNote: vi.fn(async () => true) };
vi.mock('@/components/MilkdownEditor', () => ({
  default: ({ onReady }) => {
    onReady?.(api);
    return null;
  },
}));

const { default: NotePane } = await import('./NotePane');

let root;
let host;
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function render() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const note = { id: '1', title: 'T', content: 'x', updated_at: null };
  await act(async () => {
    root.render(createElement(NotePane, { note, status: 'saved', onChange: () => {} }));
  });
}

const copyButton = () => host.querySelector('[data-copy-note]');

describe('the Copy button', () => {
  it('copies the whole note and says so', async () => {
    vi.useFakeTimers();
    await render();
    await act(async () => copyButton().click());
    expect(api.copyNote).toHaveBeenCalledTimes(1);
    expect(copyButton().textContent).toContain('Copied');
    await act(async () => vi.advanceTimersByTime(1600));
    expect(copyButton().textContent).toContain('Copy');
    expect(copyButton().textContent).not.toContain('Copied');
  });

  it('says when it could not copy', async () => {
    api.copyNote.mockResolvedValueOnce(false);
    await render();
    await act(async () => copyButton().click());
    expect(copyButton().textContent).toContain("Couldn't copy");
  });
});
