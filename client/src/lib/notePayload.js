// A note as the browser edits it, and what a save of it sends.
//
// The store keeps track of whether a title was chosen or is just the first
// line (`title_set`). A save without a title is a save of the body alone, and
// leaves a chosen title where it is - which is what stops a rename made in the
// terminal being put back by this tab's next save, as it used to be.

// The note as opened. A title nobody chose stays out of the field, where the
// placeholder shows it instead; putting it in would make the first save turn
// it into a chosen one.
export function editable(note) {
  if (!note) return note;
  return { ...note, title: note.title_set ? note.title : '', titleEdited: false };
}

// The body always; the title only once it has been edited here. A blank title
// that was edited is sent too - clearing the field hands the name back to the
// first line. A new note has nothing to overwrite, so it sends both.
export function savePayload(note) {
  if (!note.id || note.titleEdited) return { title: note.title, content: note.content };
  return { content: note.content };
}

// The list after a save: the saved note keeps its place but takes its new
// name. The list is not refetched on a save, so the open note is not lifted
// to the top mid-sentence (see App.jsx) - but a renamed note still showing
// its old name looked as if the rename had not taken.
export function withSavedName(list, saved) {
  if (!list || !saved) return list;
  const at = list.findIndex((n) => n.id === saved.id);
  if (at < 0) return list;
  const row = list[at];
  if (row.title === saved.title && row.title_set === saved.title_set) return list;
  const next = list.slice();
  next[at] = { ...row, title: saved.title, title_set: saved.title_set };
  return next;
}
