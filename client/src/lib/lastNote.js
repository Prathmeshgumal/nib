// The note that was open when the page went away, so a refresh lands back on
// it rather than on "No note open" (issue #60). It is a per-browser
// preference, like the sidebar, so it lives in localStorage - which a private
// window can refuse, and then a refresh simply opens nothing, as it used to.
const KEY = 'nib-last-note';

export function rememberLastNote(id) {
  try {
    if (id == null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(id));
  } catch {
    // Nothing to do: the note still opens, it just is not remembered.
  }
}

export function recallLastNote() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

// The remembered note, out of the list the page has just loaded. One that has
// since been deleted is not in it, and then there is nothing to reopen.
export function findLastNote(notes, id = recallLastNote()) {
  if (id == null || !Array.isArray(notes)) return null;
  return notes.find((n) => String(n.id) === String(id)) ?? null;
}
