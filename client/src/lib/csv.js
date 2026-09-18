// A comma-separated file is not a split on commas: a field can be quoted, a
// quoted field can hold commas and newlines, and a quote inside one is written
// twice. This is small enough to hand-write, and writing it keeps a parser
// dependency out of the bundle for what amounts to one state machine.

// parse returns the rows of a delimited file. The delimiter is a parameter so
// the same walk handles .tsv, which is otherwise identical.
export function parse(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  // Whether anything has been seen on this row yet, so that a trailing
  // newline at the end of the file does not add an empty row.
  let started = false;

  // Strip a byte-order mark: Excel writes one, and it would otherwise become
  // part of the first column's heading.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = '';
    started = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (quoted) {
      if (c !== '"') {
        field += c;
      } else if (src[i + 1] === '"') {
        field += '"'; // a doubled quote is one literal quote
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      endField();
    } else if (c === '\n') {
      endRow();
    } else if (c === '\r') {
      // Windows line endings: the \n that follows does the work.
    } else {
      field += c;
      started = true;
    }
  }
  if (started || field !== '' || row.length) endRow();

  return rows;
}

// delimiterFor picks the separator from the filename rather than by sniffing
// the contents, which guesses wrong on any file with commas inside its cells.
export function delimiterFor(name) {
  return /\.tsv$/i.test(name || '') ? '\t' : ',';
}
