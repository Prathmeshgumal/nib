import { afterEach, describe, expect, it } from 'vitest';
import { findLastNote, recallLastNote, rememberLastNote } from './lastNote';

afterEach(() => localStorage.clear());

describe('the last open note', () => {
  it('is remembered across a reload', () => {
    rememberLastNote(42);
    expect(recallLastNote()).toBe('42');
  });

  it('is forgotten when no note is open', () => {
    rememberLastNote(42);
    rememberLastNote(null);
    expect(recallLastNote()).toBeNull();
  });

  it('is found in the list whether its id is a number or a string', () => {
    const notes = [{ id: 7, title: 'a' }, { id: 42, title: 'b' }];
    rememberLastNote(42);
    expect(findLastNote(notes)).toBe(notes[1]);
  });

  it('opens nothing once the note has been deleted', () => {
    rememberLastNote(42);
    expect(findLastNote([{ id: 7 }])).toBeNull();
  });

  it('opens nothing when nothing was remembered', () => {
    expect(findLastNote([{ id: 7 }])).toBeNull();
  });
});
