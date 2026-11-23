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
  root = null;
  host.remove();
  vi.useRealTimers();
});

async function render(note = { id: '1', title: 'T', content: 'x', updated_at: null }, onChange = () => {}) {
  if (!root) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => {
    root.render(createElement(NotePane, { note, status: 'saved', onChange }));
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

// Issue #52: a note named by its first line showed that name as a placeholder,
// so the field looked filled but was empty - the cursor sat at its start and
// Backspace and Delete had nothing to remove.
describe('the title field', () => {
  const field = () => host.querySelector('[aria-label="Note title"]');
  // Types into the field the way the browser does, so React's onChange runs.
  const typeValue = async (value) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    await act(async () => {
      set.call(field(), value);
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const firstLine = { id: '1', title: '', titleEdited: false, content: '23 Nov\n\nOut of scope', updated_at: null };

  it('holds a name taken from the first line as text that can be edited', async () => {
    await render(firstLine);
    expect(field().value).toBe('23 Nov');
  });

  it('turns an edit of that name into a chosen title', async () => {
    const onChange = vi.fn();
    await render(firstLine, onChange);
    await typeValue('23 No');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ title: '23 No', titleEdited: true }));
  });

  it('can be cleared, and then shows the first line as a hint only', async () => {
    const onChange = vi.fn();
    await render(firstLine, onChange);
    await typeValue('');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ title: '', titleEdited: true }));
    await render({ ...firstLine, title: '', titleEdited: true });
    expect(field().value).toBe('');
    expect(field().placeholder).toBe('23 Nov');
  });

  it('follows the first line until it is edited', async () => {
    await render(firstLine);
    await render({ ...firstLine, content: '24 Nov\n\nOut of scope' });
    expect(field().value).toBe('24 Nov');
  });

  it('shows a chosen title as it is', async () => {
    await render({ ...firstLine, title: 'Sprint notes' });
    expect(field().value).toBe('Sprint notes');
  });

  it('is empty, saying Untitled, for an empty note', async () => {
    await render({ ...firstLine, content: '' });
    expect(field().value).toBe('');
    expect(field().placeholder).toBe('Untitled');
  });
});
