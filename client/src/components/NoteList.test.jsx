import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import NoteList from './NoteList';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Issue #53: with dozens of notes the sidebar was one long list, and there was
// no way to put it away.

const notes = [
  { id: 'a', title: '23 Nov', updated_at: '2026-11-23T10:00:00Z' },
  { id: 'b', title: 'Review Tool TODOs', updated_at: '2026-11-22T10:00:00Z' },
  { id: 'c', title: 'Scratchpad', updated_at: '2026-11-21T10:00:00Z' },
];

let root;
let host;
beforeEach(() => localStorage.clear());
afterEach(async () => {
  await act(async () => root.unmount());
  root = null;
  host.remove();
});

async function render(props = {}) {
  if (!root) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => {
    root.render(
      createElement(NoteList, { notes, selectedId: 'b', query: '', onQuery: () => {}, onSelect: () => {}, ...props })
    );
  });
}

const toggle = () => host.querySelector('[data-notes-toggle]');
// A folded row is hidden on a wide screen; on a phone the list is a screen of
// its own and is never folded, which is why this is a breakpoint class.
const shown = () =>
  [...host.querySelectorAll('[data-note-row]')]
    .filter((row) => !row.closest('li').className.includes('md:hidden'))
    .map((row) => row.textContent);

describe('folding the notes list', () => {
  it('shows every note to begin with', async () => {
    await render();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(shown()).toEqual(['23 Nov', 'Review Tool TODOs', 'Scratchpad']);
  });

  it('folds away all but the open note, and opens again', async () => {
    await render();
    await act(async () => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(shown()).toEqual(['Review Tool TODOs']);
    await act(async () => toggle().click());
    expect(shown()).toEqual(['23 Nov', 'Review Tool TODOs', 'Scratchpad']);
  });

  it('remembers being folded', async () => {
    await render();
    await act(async () => toggle().click());
    await act(async () => root.unmount());
    root = null;
    host.remove();
    await render();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(shown()).toEqual(['Review Tool TODOs']);
  });

  it('still shows what a search found', async () => {
    localStorage.setItem('nib.notesFolded', '1');
    await render({ query: 'o', notes: notes.slice(0, 2) });
    expect(shown()).toEqual(['23 Nov', 'Review Tool TODOs']);
  });

  it('folds to nothing when no note is open', async () => {
    localStorage.setItem('nib.notesFolded', '1');
    await render({ selectedId: null });
    expect(shown()).toEqual([]);
    expect(toggle().textContent).toContain('3');
  });
});
