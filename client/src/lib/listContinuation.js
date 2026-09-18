// Pressing Enter inside a list carries the list on to the next line, the way a
// notes app is expected to. Pressing it on an item with nothing in it ends the
// list instead, which is how a list is finished without reaching for a mouse.
//
// This is a port of internal/tui/continue.go. The two editors are meant to
// behave identically, so the regexps and the rules below mirror it line for
// line, and listContinuation.test.js carries the Go test table verbatim.

// "- ", "* ", "+ ", with any indent, optionally followed by a checkbox.
const BULLET_LINE = /^(\s*)([-*+])(\s+)(\[[ xX]\]\s+)?(.*)$/;
// "1. ", "2) ", with any indent.
const ORDERED_LINE = /^(\s*)(\d+)([.)])(\s+)(.*)$/;
// "> ", nested quotes included.
const QUOTE_LINE = /^(\s*)((?:>\s*)+)(.*)$/;

// What a new line should begin with when Enter is pressed on the given line.
//
// `prefix` is what to type after the line break. `endList` is true when the
// line is an empty item, meaning the marker should be cleared rather than
// repeated — the writer is telling us the list is over.
export function continuation(line) {
  let m = line.match(BULLET_LINE);
  if (m) {
    const [, indent, marker, gap, box, text] = m;
    if (text.trim() === '') return { prefix: '', endList: true };
    // A new task starts unticked however the one above it ended.
    if (box) return { prefix: `${indent}${marker}${gap}[ ] `, endList: false };
    return { prefix: `${indent}${marker}${gap}`, endList: false };
  }

  m = line.match(ORDERED_LINE);
  if (m) {
    const [, indent, num, dot, gap, text] = m;
    if (text.trim() === '') return { prefix: '', endList: true };
    const n = Number.parseInt(num, 10);
    if (Number.isNaN(n)) return { prefix: '', endList: false };
    return { prefix: `${indent}${n + 1}${dot}${gap}`, endList: false };
  }

  m = line.match(QUOTE_LINE);
  if (m) {
    const [, indent, markers, text] = m;
    if (text.trim() === '') return { prefix: '', endList: true };
    return { prefix: `${indent}${markers}`, endList: false };
  }

  return { prefix: '', endList: false };
}

// Where the line holding `at` begins and ends.
function lineBounds(value, at) {
  const start = value.lastIndexOf('\n', at - 1) + 1;
  const nl = value.indexOf('\n', at);
  return { start, end: nl === -1 ? value.length : nl };
}

// Enter: break the line and carry the list on. Returns the whole new value and
// where the cursor belongs, so the caller only has to set both.
export function enterInList(value, start, end = start) {
  const { start: lineStart } = lineBounds(value, start);
  const line = value.slice(lineStart, start);
  const { prefix, endList } = continuation(line);

  if (endList) {
    // Clear the marker and leave a plain empty line, rather than adding one.
    const next = value.slice(0, lineStart) + value.slice(end);
    return { value: next, caret: lineStart };
  }

  const inserted = `\n${prefix}`;
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    caret: start + inserted.length,
  };
}

// Shift+Enter: a line break that leaves the list alone.
export function plainBreak(value, start, end = start) {
  return {
    value: `${value.slice(0, start)}\n${value.slice(end)}`,
    caret: start + 1,
  };
}
