// Each action takes {value, start, end} and returns {value, start, end}
// so the caller can restore a sensible selection afterwards.

function wrap(state, token, placeholder) {
  const { value, start, end } = state;
  const selected = value.slice(start, end) || placeholder;
  const before = value.slice(0, start);
  const after = value.slice(end);

  // Toggle off if the selection is already wrapped.
  if (before.endsWith(token) && after.startsWith(token)) {
    return {
      value: before.slice(0, -token.length) + selected + after.slice(token.length),
      start: start - token.length,
      end: start - token.length + selected.length,
    };
  }
  return {
    value: `${before}${token}${selected}${token}${after}`,
    start: start + token.length,
    end: start + token.length + selected.length,
  };
}

function eachLine(state, fn) {
  const { value, start, end } = state;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEndIdx = value.indexOf('\n', end);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const block = value.slice(lineStart, lineEnd);
  const next = block.split('\n').map(fn).join('\n');
  return {
    value: value.slice(0, lineStart) + next + value.slice(lineEnd),
    start: lineStart,
    end: lineStart + next.length,
  };
}

export const actions = {
  bold: (s) => wrap(s, '**', 'bold text'),
  italic: (s) => wrap(s, '_', 'italic text'),
  strike: (s) => wrap(s, '~~', 'strikethrough'),
  code: (s) => wrap(s, '`', 'code'),

  heading: (s) =>
    eachLine(s, (line) => {
      const m = line.match(/^(#{1,6})\s/);
      if (!m) return `# ${line}`;
      return m[1].length >= 6 ? line.replace(/^#{1,6}\s/, '') : `#${line}`;
    }),

  bullet: (s) =>
    eachLine(s, (line) =>
      /^\s*-\s/.test(line) ? line.replace(/^(\s*)-\s/, '$1') : `- ${line}`
    ),

  numbered: (s) => {
    let n = 0;
    return eachLine(s, (line) => {
      if (/^\s*\d+\.\s/.test(line)) return line.replace(/^(\s*)\d+\.\s/, '$1');
      n += 1;
      return `${n}. ${line}`;
    });
  },

  task: (s) =>
    eachLine(s, (line) =>
      /^\s*-\s\[[ x]\]\s/.test(line)
        ? line.replace(/^(\s*)-\s\[[ x]\]\s/, '$1')
        : `- [ ] ${line}`
    ),

  quote: (s) =>
    eachLine(s, (line) => (/^>\s?/.test(line) ? line.replace(/^>\s?/, '') : `> ${line}`)),

  codeBlock: (s) => {
    const { value, start, end } = s;
    const selected = value.slice(start, end) || 'code here';
    const prefix = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
    const block = `${prefix}\`\`\`\n${selected}\n\`\`\`\n`;
    return {
      value: value.slice(0, start) + block + value.slice(end),
      start: start + prefix.length + 4,
      end: start + prefix.length + 4 + selected.length,
    };
  },

  link: (s, url = 'https://') => {
    const { value, start, end } = s;
    const text = value.slice(start, end) || 'link text';
    const md = `[${text}](${url})`;
    return {
      value: value.slice(0, start) + md + value.slice(end),
      // Select the URL so it can be typed over immediately.
      start: start + text.length + 3,
      end: start + text.length + 3 + url.length,
    };
  },

  // Tick or untick a task. A line that is not a task becomes one, so the same
  // key both makes a checkbox and ticks it. Mirrors alt+x in the terminal.
  toggleTask: (s) =>
    eachLine(s, (line) => {
      const box = line.match(/^(\s*[-*+]\s+)\[([ xX])\]\s(.*)$/);
      if (box) {
        const [, lead, state, text] = box;
        return `${lead}[${state === ' ' ? 'x' : ' '}] ${text}`;
      }
      const bullet = line.match(/^(\s*)([-*+])\s+(.*)$/);
      if (bullet) {
        const [, indent, marker, text] = bullet;
        return `${indent}${marker} [ ] ${text}`;
      }
      const indent = line.match(/^(\s*)(.*)$/);
      return `${indent[1]}- [ ] ${indent[2]}`;
    }),

  // Tab and Shift+Tab. The terminal cannot bind these — ctrl+i *is* Tab — so
  // this pair exists only in the browser.
  indent: (s) => eachLine(s, (line) => `  ${line}`),

  outdent: (s) => eachLine(s, (line) => line.replace(/^ {1,2}/, '')),

  hr: (s) => {
    const { value, start } = s;
    const prefix = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
    const md = `${prefix}\n---\n\n`;
    return { value: value.slice(0, start) + md + value.slice(start), start: start + md.length, end: start + md.length };
  },
};

// Tick the task on the line containing `offset`, for a click on a checkbox in
// the rendered view — the reader never enters the editor at all. Returns the
// document unchanged when that line is not a task.
export function toggleTaskAt(markdown, offset) {
  if (offset < 0 || offset > markdown.length) return markdown;
  const start = markdown.lastIndexOf('\n', offset - 1) + 1;
  const nl = markdown.indexOf('\n', offset);
  const end = nl === -1 ? markdown.length : nl;
  const line = markdown.slice(start, end);

  const m = line.match(/^(\s*[-*+]\s+)\[([ xX])\]\s(.*)$/);
  if (!m) return markdown;
  const [, lead, state, text] = m;
  const next = `${lead}[${state === ' ' ? 'x' : ' '}] ${text}`;
  return markdown.slice(0, start) + next + markdown.slice(end);
}
