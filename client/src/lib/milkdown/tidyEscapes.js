import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

// remark escapes conservatively on the way out. It cannot know whether the `_`
// in `ve_hr` or the `**` in `int **ptr2` was meant as markup, so it puts a
// backslash in front of both and lets the renderer sort it out. Every renderer
// then shows the same text it always did - but nib's other half is a terminal
// that shows you the markdown itself, where `ve\_hr` is simply wrong.
//
// Stripping those backslashes by rule is where this gets dangerous: `\#` at the
// start of a line is a `#`, but without the backslash it is a heading, and
// `\[ ]` is a pair of brackets until it becomes a checkbox. So this does not
// reason about which escapes are safe. It removes them, parses both versions,
// and keeps the shorter one only when the two parse to the same document.
// Anything it cannot prove identical it leaves exactly as remark wrote it.

// Backslash itself is not in the set. `\\` is a literal backslash, and dropping
// one leaves a `\` that escapes whatever follows it.
const ESCAPE = /\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g;

// A document with this many escaped lines is not worth the parses; the whole
// document attempt above still covers the ordinary case.
const MAX_LINES = 200;

const processor = unified().use(remarkParse).use(remarkGfm);

// Two trees are the same document when they have the same shape and the same
// content. Position is where in the text a node was found, which is exactly
// what removing a character is expected to change.
function shape(node) {
  if (Array.isArray(node)) return node.map(shape);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const key of Object.keys(node).sort()) {
    if (key === 'position') continue;
    out[key] = shape(node[key]);
  }
  return out;
}

function parsed(markdown) {
  try {
    return JSON.stringify(shape(processor.parse(markdown)));
  } catch {
    return null;
  }
}

// A line ending in a space is written as `…&#x20;`, so the space survives a
// round trip. Nobody means anything by a space at the end of a line, and the
// code leaked into titles, the sidebar and copied prompts. Code blocks are
// left as they are: there the characters are the content.
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const TRAILING_SPACE_REFS = /(?:&#x20;)+$/;

export function dropTrailingSpaceRefs(markdown) {
  if (typeof markdown !== 'string' || !markdown.includes('&#x20;')) return markdown;
  let fence = null;
  return markdown
    .split('\n')
    .map((line) => {
      const open = FENCE.exec(line);
      if (open) {
        const marker = open[1][0];
        if (fence === null) fence = marker;
        else if (fence === marker) fence = null;
        return line;
      }
      return fence === null ? line.replace(TRAILING_SPACE_REFS, '') : line;
    })
    .join('\n');
}

export function tidyEscapes(input) {
  const markdown = dropTrailingSpaceRefs(input);
  if (typeof markdown !== 'string' || !markdown.includes('\\')) return markdown;

  const whole = markdown.replace(ESCAPE, '$1');
  if (whole === markdown) return markdown;

  const original = parsed(markdown);
  if (original === null) return markdown;
  if (parsed(whole) === original) return whole;

  // One escape somewhere in the note means something. Rather than give up on
  // the whole note, try each line on its own and keep the ones that hold.
  const lines = markdown.split('\n');
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('\\')) candidates.push(i);
  }
  if (candidates.length > MAX_LINES) return markdown;

  const out = lines.slice();
  for (const i of candidates) {
    const was = out[i];
    const now = was.replace(ESCAPE, '$1');
    if (now === was) continue;
    out[i] = now;
    if (parsed(out.join('\n')) !== original) out[i] = was;
  }
  return out.join('\n');
}
