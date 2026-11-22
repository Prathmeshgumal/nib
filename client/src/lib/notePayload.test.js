import { describe, expect, it } from 'vitest';
import { editable, savePayload } from './notePayload';

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
