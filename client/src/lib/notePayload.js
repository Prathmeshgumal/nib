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
