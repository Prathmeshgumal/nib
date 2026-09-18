import { marked } from 'marked';

// A line that opens a list item. Nested items are indented, so the whitespace
// is part of the match rather than a reason to reject the line.
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/;

// A list token nests: its items carry their own tokens, and a nested list
// lives inside one of them. The sub-tokens do not tile the item's raw text —
// the marker and the trailing indentation belong to no sub-token — so the
// offsets cannot be accumulated from them. Lines can be, and one bullet line
// is one rendered <li>, at every depth.
function listItemSpans(token, start, out) {
  let at = start;
  for (const line of token.raw.split('\n')) {
    if (BULLET.test(line)) out.push({ start: at, end: at + line.length, type: 'list_item' });
    at += line.length + 1; // the newline split() removed
  }
}

// A table token exposes rows of cells with text but no offsets, so rows come
// from its own raw text: line 0 is the header, line 1 the alignment row, and
// the rest are data. Safe because marked only parses pipe tables, where one
// row is exactly one line.
function tableRowSpans(token, start, out) {
  let at = start;
  token.raw.split('\n').forEach((line, i) => {
    if (i >= 2 && line.trim() !== '') {
      out.push({ start: at, end: at + line.length, type: 'table_row' });
    }
    at += line.length + 1;
  });
}

// The byte offset of every block in the source, in document order. Token raw
// lengths tile the source exactly, so accumulating them is the whole walk.
export function blockSpans(markdown) {
  const src = markdown || '';
  const out = [];
  let at = 0;
  for (const token of marked.lexer(src)) {
    if (token.type === 'space') {
      at += token.raw.length;
      continue;
    }
    if (token.type === 'list') listItemSpans(token, at, out);
    else if (token.type === 'table') tableRowSpans(token, at, out);
    else out.push({ start: at, end: at + token.raw.length, type: token.type });
    at += token.raw.length;
  }
  return out;
}
