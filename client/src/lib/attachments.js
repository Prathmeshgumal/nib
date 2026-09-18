// What the browser can do with an attachment, worked out from its extension.
//
// The extension is the only evidence available here: the stored filename is a
// content hash plus the extension the server settled on at upload time, and
// asking the server again would cost a request per link on every render.
//
// Nothing in this file changes what a note contains. The markdown stays the
// plain `[name](attachments/abc.docx)` that the terminal writes and reads; all
// of this happens while turning that markdown into a page.

const EXT = /\.([a-z0-9]+)$/i;

function ext(name) {
  const m = EXT.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

// Kinds, and what each one means for the reader:
//
//   image   already rendered inline by markdown; nothing to do
//   video   plays inline, in the note
//   audio   plays inline, in the note
//   film    a video container no browser decodes - offer the file instead
//   pdf     Chrome's own viewer beats anything we would build; open it raw
//   docx    converted to HTML in the viewer tab
//   csv     parsed into a table in the viewer tab
//   markdown|text  shown in the viewer tab
//   file    nothing useful to show; the link downloads, as it does today
const KINDS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'],
  video: ['mp4', 'webm', 'm4v', 'mov', 'ogv'],
  audio: ['mp3', 'm4a', 'wav', 'oga', 'flac', 'aac', 'opus'],
  // Matroska, AVI and the rest: the container is fine, but no browser ships a
  // decoder for them. Saying so beats a player that silently shows nothing.
  film: ['mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'ts'],
  pdf: ['pdf'],
  docx: ['docx'],
  csv: ['csv', 'tsv'],
  markdown: ['md', 'markdown', 'mdown'],
  text: [
    'txt', 'log', 'json', 'yaml', 'yml', 'xml', 'toml', 'ini', 'env',
    'js', 'jsx', 'ts', 'tsx', 'go', 'py', 'rb', 'rs', 'java', 'kt', 'swift',
    'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'sql', 'css',
    'scss', 'diff', 'patch',
  ],
};

const BY_EXT = new Map();
for (const [kind, exts] of Object.entries(KINDS)) {
  for (const e of exts) BY_EXT.set(e, kind);
}

// `ogg` is both, and the web is split on it. Audio is the commoner intent.
BY_EXT.set('ogg', 'audio');

export function kindOf(name) {
  return BY_EXT.get(ext(name)) || 'file';
}

// The kinds the viewer tab can actually show something for. Video and audio
// are absent on purpose: those play in the note, so sending the reader to
// another tab would be a step backwards.
const VIEWABLE = new Set(['docx', 'csv', 'markdown', 'text', 'film']);

export function isViewable(name) {
  return VIEWABLE.has(kindOf(name));
}

// A stored file's name on disk: the first 16 hex of the content hash, and a
// short extension. This mirrors the Go side's `reference` in
// internal/attach/ref.go, and has to keep mirroring it.
const STORED = '([0-9a-f]{16}\\.[a-z0-9]{1,8})';

// An attachment href as a note spells it, anchored at both ends so a remote
// URL ending the same way, or a path with a directory in it, is not mistaken
// for one.
const HREF = new RegExp(`^attachments/${STORED}$`);
const ROUTE = new RegExp(`^/view/${STORED}$`);

// storedName pulls the file's name on disk out of a link's href, or returns
// null when the href is not one of ours.
export function storedName(href) {
  const m = HREF.exec(href || '');
  return m ? m[1] : null;
}

// Where a link should point. The viewer is an absolute path because the
// viewer page itself lives at /view/<name>, where a relative one would
// resolve against the wrong directory.
//
// The name on disk is a hash, so the label - the filename the reader actually
// chose - has to travel with it if the viewer is to have a title worth
// showing. It is only ever displayed, never used to find the file.
export function viewerHref(name, label) {
  const q = label ? `?name=${encodeURIComponent(label)}` : '';
  return `/view/${name}${q}`;
}

// viewerRoute reads that URL back, and is how the app decides it is showing a
// file rather than the notes. A null means this is not the viewer.
export function viewerRoute(pathname, search = '') {
  const m = ROUTE.exec(pathname || '');
  if (!m) return null;
  let label = null;
  try {
    label = new URLSearchParams(search).get('name');
  } catch {
    // A malformed query string costs the title, not the page.
  }
  return { name: m[1], label: label || m[1] };
}

export function rawHref(name) {
  return `/attachments/${name}`;
}
