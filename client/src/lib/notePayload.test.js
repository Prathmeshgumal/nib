import { describe, expect, it } from 'vitest';
import { editable, savePayload, withSavedName } from './notePayload';

describe('opening a note for editing', () => {
  it('leaves the title field blank when the title follows the first line', () => {
    const n = editable({ id: '1', title: 'shopping list', title_set: false, content: 'shopping list' });
    expect(n.title).toBe('');
    expect(n.titleEdited).toBe(false);
  });

  it('shows a title someone chose', () => {
    expect(editable({ id: '1', title: 'Groceries', title_set: true, content: 'x' }).title).toBe('Groceries');
  });
});

describe('what a save sends', () => {
  // The bug: every save carried the title this tab opened with, which put back
  // the old one over a rename made in the terminal meanwhile.
  it('sends only the body while the title has not been touched', () => {
    expect(savePayload({ id: '1', title: '', titleEdited: false, content: 'body' })).toEqual({ content: 'body' });
  });

  it('sends the title once it has been edited, blank included', () => {
    expect(savePayload({ id: '1', title: 'New', titleEdited: true, content: 'b' })).toEqual({ title: 'New', content: 'b' });
    expect(savePayload({ id: '1', title: '', titleEdited: true, content: 'b' })).toEqual({ title: '', content: 'b' });
  });

  it('sends both when creating', () => {
    expect(savePayload({ id: null, title: '', content: 'b' })).toEqual({ title: '', content: 'b' });
  });
});

describe('withSavedName', () => {
  const list = [
    { id: 'a', title: 'Older', title_set: true, updated_at: '1' },
    { id: 'b', title: '23 Nov', title_set: false, updated_at: '2' },
  ];

  it('gives the saved note its new name, where it already is in the list', () => {
    const out = withSavedName(list, { id: 'b', title: '23 November planning', title_set: true, updated_at: '3' });
    expect(out.map((n) => n.id)).toEqual(['a', 'b']);
    expect(out[1]).toMatchObject({ title: '23 November planning', title_set: true });
  });

  it('leaves the list as it was when the name did not change', () => {
    expect(withSavedName(list, { id: 'b', title: '23 Nov', title_set: false })).toBe(list);
  });

  it('leaves a list without the note alone', () => {
    expect(withSavedName(list, { id: 'z', title: 'New' })).toBe(list);
    expect(withSavedName(null, { id: 'b', title: 'New' })).toBe(null);
  });
});
