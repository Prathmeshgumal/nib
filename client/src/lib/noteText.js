// The words a note is known by in the list and the title line, worked out the
// same way in both places so the two never disagree about what a note is
// called.

// Markdown's backslash escapes, as the reader means them: `a\*b` is `a*b`, and
// `\\` is one backslash. Shown raw, a note you typed `C:\` into was listed as
// `C:\\`. The set is CommonMark's ASCII punctuation, the same one Unescape in
// internal/store undoes.
export const unescapeMarkdown = (s) =>
  s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');

// What the line looks like as text: the markers that make it a heading, a
// quote, a list item or a task taken off the front.
const plainLine = (line) =>
  unescapeMarkdown(
    line
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)*/, '')
      .replace(/[*_`~]/g, '')
      .trim(),
  );

// The title the store gives a note that was saved without one: its first line
// with words on it. Mirrors DeriveTitle in internal/store, so the title line
// shows, while you are still typing, what the list will call the note.
export function deriveTitle(title, content) {
  const t = (title || '').trim();
  if (t) return t;
  // Unescaped first, then the first line - the order the store does it in.
  for (const line of unescapeMarkdown(content || '').split('\n')) {
    // Exactly what the store does - strip leading '#' and spaces, then trim -
    // so the two cannot drift apart.
    const words = line.trim().replace(/^[#\s]+/, '').trim();
    if (words) return words.slice(0, 200);
  }
  return '';
}

// The line of a note worth previewing in the list. A note usually opens with
// its title, and showing that again under the title says nothing - but a note
// whose only line is its title is not empty, and saying so was wrong.
export function excerpt(content, title) {
  const lines = (content || '')
    .split('\n')
    .map(plainLine)
    .filter(Boolean);
  const heading = unescapeMarkdown((title || '').trim());
  const rest = lines.find((l) => l !== heading);
  if (rest) return rest.slice(0, 90);
  return lines.length ? '' : 'Empty note';
}
