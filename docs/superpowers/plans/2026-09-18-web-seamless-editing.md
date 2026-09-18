# Seamless Editing in the Web UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Edit button from the web UI — a note opens rendered, and clicking the prose puts you in its Markdown source with the cursor at the block you clicked.

**Architecture:** A pure function maps Markdown to block byte-offsets. The renderer stamps those offsets onto the rendered elements as `data-src`. A single `NotePane` owns a `read`/`write` mode; a click in the rendered article reads the nearest `data-src` and opens the textarea with the caret there. Autosave sits on top as a net, with `Ctrl+S` and `Esc` keeping their current meanings.

**Tech Stack:** React 18, Vite 5, `marked` ^13, `dompurify` ^3, Tailwind 4. Tests added by this plan: `vitest` + `jsdom`.

**Spec:** `docs/superpowers/specs/2026-09-18-web-seamless-editing-design.md`

## Global Constraints

- **Do not add a runtime dependency.** The bundle is 131 KB gzipped inside a binary whose pitch is that it is one small file. `vitest` and `jsdom` are **dev**-only. No CodeMirror, no editor engine.
- **`marked` stays at ^13.** Token-object renderers only exist from v15; this plan does not upgrade it. (Verified: in ^13, `renderer.heading` still receives `(text, level, raw)`, so offsets cannot be stamped from a custom renderer.)
- **`Ctrl+S` saves and `Esc` cancels.** The TUI footer reads `ctrl+s save … esc cancel`; the two halves of the app must agree. Only the **Edit** button is removed.
- **The cursor lands at the start of the clicked block**, never at the character under the pointer.
- **Wrong offsets are worse than no offsets.** Every stamping pass fails closed: if element count and span count disagree, stamp nothing.
- Existing behaviour that must keep working: the title input, drag-and-drop and paste attachments, `editorActions.js` toolbar helpers, the note list, search, and trash.

## File Structure

| File | Responsibility |
| --- | --- |
| `client/src/lib/sourceMap.js` (new) | Markdown → block offsets; DOM → stampable elements; click → offset. Pure, no React. |
| `client/src/lib/autosave.js` (new, Task 3) | Debounce-and-flush scheduler. Pure, no React, no DOM. |
| `client/src/lib/markdown.js` (modify) | `renderMarkdown` gains the offset-stamping pass. |
| `client/src/components/NotePane.jsx` (new, Task 2) | Owns `read`/`write` and the switch between them. Replaces `SavedView` + `Editor` as alternate screens. |
| `client/src/components/ReadView.jsx` (new, Task 2) | Rendered article + header. `SavedView.jsx` minus the Edit button. |
| `client/src/components/Editor.jsx` (modify) | Gains a `caretAt` prop and an `onCancel`; loses nothing else. |
| `client/src/App.jsx` (modify) | `draft`/`viewing` collapse into `note` + `mode` + `baseline`. |
| `client/src/lib/*.test.js` (new) | Vitest suites beside the modules they test. |

`sourceMap.js` holds three small functions with one job between them and no knowledge of React, so it carries the tests for the riskiest logic. The React components are wired by hand and verified in a browser, which is why Tasks 2 and 3 push every decidable rule down into a pure module rather than testing components.

---

### Task 1: Block offsets and the stamping renderer

Pure functions and markup. No behaviour change — the rendered view gains attributes nothing reads yet. This task also stands up the client's first test runner.

**Files:**
- Create: `client/src/lib/sourceMap.js`
- Create: `client/src/lib/sourceMap.test.js`
- Create: `client/src/lib/markdown.test.js`
- Create: `client/vitest.config.js`
- Modify: `client/package.json` (devDependencies + a `test` script)
- Modify: `client/src/lib/markdown.js`
- Modify: `.github/workflows/ci.yml` (add a `client` job)

**Interfaces:**
- Produces:
  - `blockSpans(markdown: string) => Array<{start: number, end: number, type: string}>` — document order, byte offsets into `markdown`.
  - `stampTargets(root: Element) => Element[]` — the elements that correspond, one-to-one and in document order, to `blockSpans` of the same source.
  - `offsetFromClick(target: Node, root: Element) => number | null` — nearest `[data-src]` ancestor at or above `target`, bounded by `root`.
  - `renderMarkdown(src: string) => string` — unchanged signature; the HTML now carries `data-src`.
- Consumes: nothing.

- [ ] **Step 1: Add the test runner**

```bash
cd client
npm install --save-dev vitest@^2.1.9 jsdom@^25.0.1
```

Then add the script to `client/package.json`, leaving the other scripts as they are:

```json
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "preview": "vite preview --host 0.0.0.0",
    "test": "vitest run"
  },
```

Create `client/vitest.config.js`:

```js
import { defineConfig } from 'vite';
import path from 'node:path';

// The client has no test runner of its own; this is vite's config plus the
// jsdom environment, so imports resolve exactly as they do in the app.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { environment: 'jsdom', include: ['src/**/*.test.js'] },
});
```

- [ ] **Step 2: Write the failing test for `blockSpans`**

Create `client/src/lib/sourceMap.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { blockSpans, offsetFromClick, stampTargets } from './sourceMap';

// The note that prompted this feature: a heading, prose, a wide table and a
// nested list.
const DOC = [
  '# Companies Breakdown',
  '',
  'A **bold** word and a [link](https://example.com).',
  '',
  '| # | Company | CTC |',
  '| - | ------- | --- |',
  '| 1 | Google | 30L |',
  '| 2 | Microsoft | 25L |',
  '| 3 | Stripe | 50L |',
  '',
  '- A database allows reads and writes.',
  '  - In any application there are more reads.',
  '    - Deeply nested item',
  '- Second top-level item',
  '',
  '> quoted text',
  '',
  '```',
  'code here',
  '```',
  '',
  'Final paragraph.',
].join('\n');

describe('blockSpans', () => {
  it('starts every span at the first character of its block', () => {
    const at = (needle) => DOC.indexOf(needle);
    const starts = blockSpans(DOC).map((s) => s.start);
    for (const needle of [
      '# Companies Breakdown',
      'A **bold**',
      '| 1 | Google',
      '| 3 | Stripe',
      '- A database',
      '  - In any application',
      '    - Deeply nested item',
      '- Second top-level item',
      '> quoted text',
      'Final paragraph.',
    ]) {
      expect(starts).toContain(at(needle));
    }
  });

  it('gives a nested bullet its own span, not its parent-s', () => {
    const spans = blockSpans(DOC).filter((s) => s.type === 'list_item');
    expect(spans).toHaveLength(4);
    expect(DOC.slice(spans[2].start, spans[2].end)).toBe('    - Deeply nested item');
  });

  it('gives one span per table data row and none for the header', () => {
    const rows = blockSpans(DOC).filter((s) => s.type === 'table_row');
    expect(rows.map((r) => DOC.slice(r.start, r.end))).toEqual([
      '| 1 | Google | 30L |',
      '| 2 | Microsoft | 25L |',
      '| 3 | Stripe | 50L |',
    ]);
  });

  it('never returns an empty span', () => {
    for (const s of blockSpans(DOC)) expect(s.end).toBeGreaterThan(s.start);
  });

  it('handles an empty note', () => {
    expect(blockSpans('')).toEqual([]);
    expect(blockSpans(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd client && npm test`
Expected: FAIL — `Failed to resolve import "./sourceMap"`.

- [ ] **Step 4: Write `blockSpans`**

Create `client/src/lib/sourceMap.js`:

```js
import { marked } from 'marked';

// A line that opens a list item. Nested items are indented, so the whitespace
// is part of the match rather than a reason to reject the line.
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/;

// A list token nests: its items carry their own tokens, and a nested list
// lives inside one of them. The sub-tokens do not tile the item's raw text -
// the marker and the trailing indentation belong to no sub-token - so the
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
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `cd client && npm test`
Expected: PASS — 5 tests in `sourceMap.test.js`.

- [ ] **Step 6: Commit**

```bash
git add client/package.json client/package-lock.json client/vitest.config.js client/src/lib/sourceMap.js client/src/lib/sourceMap.test.js
git commit -m "map markdown blocks to their place in the source"
```

- [ ] **Step 7: Write the failing test for `stampTargets` and `offsetFromClick`**

Append to `client/src/lib/sourceMap.test.js`:

```js
function render(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('stampTargets', () => {
  it('returns one element per span, in the same order', () => {
    const host = render(
      '<h1>h</h1>' +
        '<table><thead><tr><th>#</th></tr></thead><tbody><tr><td>1</td></tr><tr><td>2</td></tr></tbody></table>' +
        '<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>' +
        '<p>p</p>'
    );
    expect(stampTargets(host).map((el) => el.tagName)).toEqual([
      'H1', 'TR', 'TR', 'LI', 'LI', 'LI', 'P',
    ]);
  });

  it('does not descend into a blockquote, which is one block', () => {
    const host = render('<blockquote><p>a</p><p>b</p></blockquote>');
    expect(stampTargets(host).map((el) => el.tagName)).toEqual(['BLOCKQUOTE']);
  });
});

describe('offsetFromClick', () => {
  it('finds the offset on the nearest stamped ancestor', () => {
    const host = render('<p data-src="42">a <strong>word</strong></p>');
    const strong = host.querySelector('strong');
    expect(offsetFromClick(strong.firstChild, host)).toBe(42);
  });

  it('returns null for a click on padding, above every stamped element', () => {
    const host = render('<p data-src="42">a</p>');
    expect(offsetFromClick(host, host)).toBeNull();
  });
});
```

- [ ] **Step 8: Run it to make sure it fails**

Run: `cd client && npm test`
Expected: FAIL — `stampTargets is not a function`.

- [ ] **Step 9: Write `stampTargets` and `offsetFromClick`**

Append to `client/src/lib/sourceMap.js`:

```js
// The rendered counterparts of blockSpans, in document order. A list renders
// as one element holding many items and a table as one holding many rows, so
// both are opened up; everything else is one block, one element - including a
// blockquote, which blockSpans also treats as a single block.
export function stampTargets(root) {
  const out = [];
  for (const el of root.children) {
    if (el.tagName === 'UL' || el.tagName === 'OL') out.push(...el.querySelectorAll('li'));
    else if (el.tagName === 'TABLE') out.push(...el.querySelectorAll('tbody tr'));
    else out.push(el);
  }
  return out;
}

// Where in the source the clicked block begins, or null when the click landed
// on padding rather than on any block.
export function offsetFromClick(target, root) {
  let el = target instanceof Element ? target : target?.parentElement;
  while (el && el !== root) {
    const at = el.getAttribute('data-src');
    if (at !== null) return Number(at);
    el = el.parentElement;
  }
  return null;
}
```

- [ ] **Step 10: Run the tests and make sure they pass**

Run: `cd client && npm test`
Expected: PASS — 9 tests.

- [ ] **Step 11: Write the failing test for the stamping renderer**

Create `client/src/lib/markdown.test.js`:

```js
import { expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

const parse = (html) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
};

it('stamps each rendered block with where it starts in the source', () => {
  const src = '# Title\n\nA paragraph.\n\n- one\n  - nested\n';
  const host = parse(renderMarkdown(src));
  const stamped = [...host.querySelectorAll('[data-src]')].map((el) => [
    el.tagName,
    src.slice(Number(el.getAttribute('data-src'))).split('\n')[0],
  ]);
  expect(stamped).toEqual([
    ['H1', '# Title'],
    ['P', 'A paragraph.'],
    ['LI', '- one'],
    ['LI', '  - nested'],
  ]);
});

it('still strips dangerous markup', () => {
  expect(renderMarkdown('<img src=x onerror=alert(1)>')).not.toContain('onerror');
});

it('renders an empty note without throwing', () => {
  expect(renderMarkdown('')).toBe('');
});
```

- [ ] **Step 12: Run it to make sure it fails**

Run: `cd client && npm test`
Expected: FAIL — the first test, because nothing carries `data-src` yet.

- [ ] **Step 13: Add the stamping pass**

Replace `client/src/lib/markdown.js` entirely:

```js
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { blockSpans, stampTargets } from '@/lib/sourceMap';

marked.setOptions({ gfm: true, breaks: true });

// Note content is user-authored markdown; sanitize before it touches the DOM.
// The offsets are stamped after sanitizing, so they are ours rather than
// something the sanitizer had to be persuaded to keep.
export function renderMarkdown(src) {
  const clean = DOMPurify.sanitize(marked.parse(src || ''), {
    ADD_ATTR: ['target', 'rel'],
  });
  const host = document.createElement('div');
  host.innerHTML = clean;

  const spans = blockSpans(src);
  const targets = stampTargets(host);
  // A wrong offset sends the cursor to the wrong line, which is worse than no
  // click-to-edit at all. If the two walks ever disagree, stamp nothing.
  if (targets.length !== spans.length) return clean;
  targets.forEach((el, i) => el.setAttribute('data-src', String(spans[i].start)));
  return host.innerHTML;
}
```

- [ ] **Step 14: Run the tests and make sure they pass**

Run: `cd client && npm test`
Expected: PASS — 12 tests across both files.

- [ ] **Step 15: Check the build still works**

Run: `cd client && npm run build`
Expected: builds with no error. Note the reported gzip size of the main chunk and confirm it has not grown — nothing was added to the bundle.

- [ ] **Step 16: Wire the tests into CI**

In `.github/workflows/ci.yml`, add a third job after `build`, at the same indentation as the existing `test:` and `build:` keys:

```yaml
  client:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: client/package-lock.json

      - name: Install
        run: npm ci
        working-directory: client

      - name: Test
        run: npm test
        working-directory: client
```

- [ ] **Step 17: Commit**

```bash
git add client/src/lib/markdown.js client/src/lib/markdown.test.js client/src/lib/sourceMap.js client/src/lib/sourceMap.test.js .github/workflows/ci.yml
git commit -m "stamp rendered blocks with their source position"
```

---

### Task 2: The read/write switch

The user-visible change. The Edit button goes; clicking the prose opens the source with the cursor where you clicked. `Ctrl+S` and `Esc` keep the meanings they have today.

**Files:**
- Create: `client/src/components/NotePane.jsx`
- Create: `client/src/components/ReadView.jsx`
- Delete: `client/src/components/SavedView.jsx`
- Modify: `client/src/components/Editor.jsx`
- Modify: `client/src/App.jsx`
- Modify: `client/src/lib/sourceMap.js` (add `scrollCaretIntoView`)
- Modify: `client/src/lib/sourceMap.test.js`

**Interfaces:**
- Consumes: `renderMarkdown`, `offsetFromClick` from Task 1.
- Produces:
  - `scrollCaretIntoView(textarea: HTMLTextAreaElement, offset: number) => void`
  - `<NotePane note mode onMode onChange onSave onCancel onDelete saving dirty />`
  - `<ReadView note onDelete onOpenAt />` where `onOpenAt(offset: number | null)` fires on a click in the article.
  - `<Editor … caretAt={number|null} onCancel={() => void} />` — `caretAt` places the cursor once, on mount or when it changes.

- [ ] **Step 1: Write the failing test for `scrollCaretIntoView`**

Append to `client/src/lib/sourceMap.test.js`:

```js
import { scrollCaretIntoView } from './sourceMap';

it('scrolls a long note so the caret line is roughly centred', () => {
  const el = document.createElement('textarea');
  el.value = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
  document.body.appendChild(el);
  Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
  el.style.lineHeight = '20px';

  const offset = el.value.indexOf('line 100');
  scrollCaretIntoView(el, offset);
  // line 100 sits at 2000px; centring it in a 300px box puts the top at 1850.
  expect(el.scrollTop).toBe(1850);
});

it('does not scroll above the top for a caret on the first line', () => {
  const el = document.createElement('textarea');
  el.value = 'first\nsecond';
  document.body.appendChild(el);
  scrollCaretIntoView(el, 0);
  expect(el.scrollTop).toBe(0);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd client && npm test`
Expected: FAIL — `scrollCaretIntoView is not a function`.

- [ ] **Step 3: Write `scrollCaretIntoView`**

Append to `client/src/lib/sourceMap.js`:

```js
// Put the caret's line near the middle of the box. Soft wrapping means a long
// line occupies more than one row, so this is a hint rather than a
// measurement - the caret itself is exact, and the browser nudges the last bit
// once the textarea has focus.
export function scrollCaretIntoView(el, offset) {
  const lineHeight = parseFloat(window.getComputedStyle(el).lineHeight) || 20;
  const line = (el.value.slice(0, offset).match(/\n/g) || []).length;
  el.scrollTop = Math.max(0, line * lineHeight - el.clientHeight / 2);
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd client && npm test`
Expected: PASS — 14 tests.

- [ ] **Step 5: Create `ReadView.jsx`**

This is `SavedView.jsx` with the Edit button removed and the article made clickable. Create `client/src/components/ReadView.jsx`:

```jsx
import { Clock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { DeleteNoteDialog } from '@/components/DeleteNoteDialog';
import { renderMarkdown } from '@/lib/markdown';
import { offsetFromClick } from '@/lib/sourceMap';
import { fullTime, relativeTime } from '@/lib/time';

export default function ReadView({ note, onDelete, onOpenAt }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight">{note.title}</h2>
          <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
            <Clock className="size-3.5" />
            <span title={fullTime(note.updated_at)}>
              Updated {relativeTime(note.updated_at)}
            </span>
            <Badge variant="outline" className="ml-1">Saved</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DeleteNoteDialog title={note.title} onConfirm={() => onDelete(note.id)}>
            <Button variant="outline" size="icon" aria-label="Delete note">
              <Trash2 className="text-destructive" />
            </Button>
          </DeleteNoteDialog>
        </div>
      </div>

      <Separator />

      {/* Clicking the prose is how you start writing; there is no Edit button. */}
      <article
        className="prose prose-zinc dark:prose-invert min-h-0 max-w-none flex-1 cursor-text overflow-y-auto pb-6"
        onClick={(e) => {
          // A link is a link first. Let the browser follow it.
          if (e.target.closest('a')) return;
          onOpenAt(offsetFromClick(e.target, e.currentTarget));
        }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}
      />
    </div>
  );
}
```

- [ ] **Step 6: Give `Editor` a caret position and a cancel key**

In `client/src/components/Editor.jsx`, change the signature on line 52:

```jsx
export default function Editor({ note, onChange, onSave, onCancel, onDelete, saving, dirty, caretAt }) {
```

Add this effect immediately after the existing `useEffect(() => setTab('write'), [note.id]);` on line 126:

```jsx
  // Land the cursor where the reader clicked, once per click. `caretAt` is a
  // fresh object each time so that clicking the same block twice still moves
  // the cursor back to it.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !caretAt) return;
    el.focus();
    const at = Math.min(caretAt.offset ?? 0, el.value.length);
    el.setSelectionRange(at, at);
    scrollCaretIntoView(el, at);
  }, [caretAt]);
```

Add the import beside the others at the top:

```jsx
import { scrollCaretIntoView } from '@/lib/sourceMap';
```

And in `onKeyDown` (line 109), handle `Escape` before the `mod` guard returns:

```jsx
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
```

Finally, update the footer hint on lines 230-233 so `Esc` is discoverable:

```jsx
          <p className="text-muted-foreground text-xs">
            Markdown supported · <kbd className="font-mono">Ctrl+S</kbd> to save ·{' '}
            <kbd className="font-mono">Esc</kbd> to cancel · drop or paste a file to
            attach it
          </p>
```

- [ ] **Step 7: Create `NotePane.jsx`**

Create `client/src/components/NotePane.jsx`:

```jsx
import Editor from '@/components/Editor';
import ReadView from '@/components/ReadView';

// The two faces of one open note. Which one shows is a mode, not a different
// note, which is what lets a click move between them.
export default function NotePane({
  note, mode, onOpenAt, onChange, onSave, onCancel, onDelete, saving, dirty, caretAt,
}) {
  if (mode === 'write') {
    return (
      <Editor
        note={note}
        onChange={onChange}
        onSave={onSave}
        onCancel={onCancel}
        onDelete={onDelete}
        saving={saving}
        dirty={dirty}
        caretAt={caretAt}
      />
    );
  }
  return <ReadView note={note} onDelete={onDelete} onOpenAt={onOpenAt} />;
}
```

- [ ] **Step 8: Collapse the two states in `App.jsx`**

Replace the `draft`/`viewing` pair on lines 24-25 with:

```jsx
  const [note, setNote] = useState(null);       // the open note
  const [mode, setMode] = useState('read');     // 'read' | 'write'
  const [baseline, setBaseline] = useState(''); // content when write mode began
  const [caretAt, setCaretAt] = useState(null); // {offset} for one click
```

Replace `startNew` (lines 59-63):

```jsx
  const startNew = () => {
    setNote(blankNote());
    setBaseline('');
    setMode('write');
    setCaretAt({ offset: 0 });
    setDirty(false);
  };
```

Replace `save` (lines 65-83). It no longer switches screens — writing and reading are the same note now:

```jsx
  const save = async () => {
    if (!note) return;
    setSaving(true);
    try {
      const payload = { title: note.title, content: note.content };
      const saved = note.id
        ? await updateNote(note.id, payload)
        : await createNote(payload);
      setDirty(false);
      setNote(saved);
      await refresh(query);
      toast.success(note.id ? 'Note saved' : 'Note created');
      return saved;
    } catch (e) {
      toast.error('Save failed', { description: e.message });
    } finally {
      setSaving(false);
    }
  };
```

Add the three handlers the pane needs, after `save`:

```jsx
  // Clicking the prose is the whole gesture: the note stays put, the pane
  // turns into its source, and the cursor lands where the click did.
  const openAt = (offset) => {
    setBaseline(note.content);
    setMode('write');
    setCaretAt(offset === null ? null : { offset });
  };

  // Esc puts back what was there when writing began and saves that, so a
  // discard is one more save rather than a second mechanism.
  const cancel = async () => {
    setCaretAt(null);
    setMode('read');
    if (note.content === baseline) return;
    setNote((n) => ({ ...n, content: baseline }));
    setDirty(false);
  };

  const saveAndRead = async () => {
    await save();
    setMode('read');
    setCaretAt(null);
  };
```

Replace every remaining `setDraft(null); setViewing(...)` pair. In `remove` (lines 88-89):

```jsx
      setNote(null);
      setMode('read');
```

In `restore` (line 106):

```jsx
      setNote(note);
      setMode('read');
```

Note the shadowed name: `restore` already has a local `const note = await restoreNote(id)`. Rename that local to `restored` and use `setNote(restored)` so it does not collide with the state variable.

Then replace the render block (lines 146-189):

```jsx
      <NoteList
        notes={notes}
        selectedId={note?.id}
        onSelect={(next) => {
          setNote(next);
          setMode('read');
          setCaretAt(null);
          setDirty(false);
        }}
        onNew={startNew}
        query={query}
        onQuery={setQuery}
        trashCount={trash.length}
        onOpenTrash={() => setTrashOpen(true)}
        canUndo={deleted.length > 0}
        onUndo={undoLastDelete}
      />

      <main className="flex min-h-0 flex-1 flex-col p-4 md:p-6">
        <Card className="flex min-h-0 flex-1 flex-col gap-0 p-5">
          {note ? (
            <NotePane
              note={note}
              mode={mode}
              caretAt={caretAt}
              onOpenAt={openAt}
              onChange={(next) => {
                setNote(next);
                setDirty(true);
              }}
              onSave={saveAndRead}
              onCancel={cancel}
              onDelete={remove}
              saving={saving}
              dirty={dirty || !note.id}
            />
          ) : (
            <EmptyState onNew={startNew} />
          )}
        </Card>
      </main>
```

Finally fix the imports on lines 4-5:

```jsx
import NotePane from '@/components/NotePane';
```

removing the `Editor` and `SavedView` imports — `NotePane` owns both now.

- [ ] **Step 9: Delete the old view**

```bash
rm client/src/components/SavedView.jsx
grep -rn "SavedView" client/src || echo "no references left"
```

Expected: `no references left`.

- [ ] **Step 10: Run the tests and the build**

Run: `cd client && npm test && npm run build`
Expected: PASS, then a clean build with no unresolved import.

- [ ] **Step 11: Verify by hand in a browser**

The React wiring is not covered by tests, so walk it once:

```bash
export PATH="$HOME/.local/go/bin:$PATH"
cd /home/prathmesh/Projects/note && ./build.sh && ./nib --web --port 4321 --db /tmp/seamless.db
```

Open `http://127.0.0.1:4321`, create a note holding a heading, a paragraph, a three-row table and a nested list, save it, then check:

1. The note opens rendered, and there is **no Edit button**.
2. Clicking the paragraph switches to source with the cursor at its first character.
3. Clicking the third table row puts the cursor at the start of that row's line.
4. Clicking a nested bullet puts the cursor on that bullet's line, not its parent's.
5. Clicking the padding below the text focuses the textarea without moving the cursor.
6. Clicking a link in the prose follows the link instead of switching to source.
7. `Ctrl+S` saves and returns to the rendered view.
8. `Esc` after typing puts the text back as it was and returns to the rendered view.
9. Dragging a file onto the textarea still attaches it.

- [ ] **Step 12: Commit**

```bash
git add -A client/src .github
git commit -m "click a note to start writing in it"
```

---

### Task 3: Autosave and the status indicator

The net under the switch: work is not lost if you never press anything.

**Files:**
- Create: `client/src/lib/autosave.js`
- Create: `client/src/lib/autosave.test.js`
- Modify: `client/src/App.jsx`
- Modify: `client/src/components/Editor.jsx` (the badge)

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: `createAutosave({ delay, save }) => { schedule(payload), flush(), cancel(), pending() }` where `save(payload)` may be async.

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/autosave.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from './autosave';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createAutosave', () => {
  it('saves once, after typing stops', async () => {
    const save = vi.fn();
    const auto = createAutosave({ delay: 800, save });
    auto.schedule('a');
    auto.schedule('ab');
    auto.schedule('abc');
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');
  });

  it('flushes a pending save immediately', async () => {
    const save = vi.fn();
    const auto = createAutosave({ delay: 800, save });
    auto.schedule('abc');
    await auto.flush();
    expect(save).toHaveBeenCalledWith('abc');

    // The timer must not fire a second save for the same text.
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flushes nothing when nothing is pending', async () => {
    const save = vi.fn();
    await createAutosave({ delay: 800, save }).flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('cancels a pending save', async () => {
    const save = vi.fn();
    const auto = createAutosave({ delay: 800, save });
    auto.schedule('abc');
    auto.cancel();
    await vi.advanceTimersByTimeAsync(800);
    expect(save).not.toHaveBeenCalled();
  });

  it('reports whether a save is waiting', () => {
    const auto = createAutosave({ delay: 800, save: vi.fn() });
    expect(auto.pending()).toBe(false);
    auto.schedule('abc');
    expect(auto.pending()).toBe(true);
    auto.cancel();
    expect(auto.pending()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd client && npm test`
Expected: FAIL — `Failed to resolve import "./autosave"`.

- [ ] **Step 3: Write the scheduler**

Create `client/src/lib/autosave.js`:

```js
// Saves the last thing it was handed, once typing has stopped. Kept apart
// from React so that the rule - one save per pause, never one per keystroke -
// can be tested without a component.
export function createAutosave({ delay = 800, save }) {
  let timer = null;
  let waiting = null; // the payload a scheduled save would write

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const run = async () => {
    if (waiting === null) return;
    const payload = waiting;
    waiting = null;
    clear();
    await save(payload);
  };

  return {
    schedule(payload) {
      waiting = payload;
      clear();
      timer = setTimeout(run, delay);
    },
    flush: run,
    cancel() {
      waiting = null;
      clear();
    },
    pending() {
      return waiting !== null;
    },
  };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd client && npm test`
Expected: PASS — 19 tests across three files.

- [ ] **Step 5: Wire it into `App.jsx`**

Add the imports:

```jsx
import { useMemo, useRef } from 'react';
import { createAutosave } from '@/lib/autosave';
```

Add a status state beside the others:

```jsx
  const [status, setStatus] = useState('saved'); // 'saved' | 'editing' | 'saving'
```

`save` needs a form that does not toast on every autosave. Split it: keep `save` as the on-demand one, and add a quiet writer above it that both use. Replace the body of `save` with a call into it:

```jsx
  // The latest note, readable from a timer that fired before the last render.
  const noteRef = useRef(null);
  noteRef.current = note;

  const write = useCallback(async ({ quiet }) => {
    const current = noteRef.current;
    if (!current) return;
    setStatus('saving');
    setSaving(true);
    try {
      const payload = { title: current.title, content: current.content };
      const saved = current.id
        ? await updateNote(current.id, payload)
        : await createNote(payload);
      setDirty(false);
      setStatus('saved');
      // Keep the id a create just handed back, but not a stale body: the
      // note may have been typed into while the request was in flight.
      setNote((n) => (n ? { ...n, id: saved.id, updated_at: saved.updated_at } : saved));
      if (!quiet) toast.success(current.id ? 'Note saved' : 'Note created');
      return saved;
    } catch (e) {
      setStatus('editing');
      toast.error('Save failed', { description: e.message });
    } finally {
      setSaving(false);
    }
  }, []);

  const autosave = useMemo(
    () => createAutosave({ delay: 800, save: () => write({ quiet: true }) }),
    [write],
  );

  const save = () => write({ quiet: false });
```

Then, in the `onChange` handler passed to `NotePane`, schedule a save:

```jsx
              onChange={(next) => {
                setNote(next);
                setDirty(true);
                setStatus('editing');
                autosave.schedule(next);
              }}
```

`Ctrl+S` and `Esc` must both cancel what is pending first, so neither races the timer. Update `saveAndRead` and `cancel`:

```jsx
  const saveAndRead = async () => {
    autosave.cancel();
    await save();
    setMode('read');
    setCaretAt(null);
  };

  const cancel = async () => {
    autosave.cancel();
    setCaretAt(null);
    setMode('read');
    if (!note || note.content === baseline) return;
    setNote((n) => ({ ...n, content: baseline }));
    setDirty(false);
    setStatus('saving');
    // The restore is itself a save, so the discard survives a reload.
    noteRef.current = { ...note, content: baseline };
    await write({ quiet: true });
    await refresh(query);
  };
```

Selecting another note must flush first, or the pending save lands on a note that is no longer open:

```jsx
        onSelect={async (next) => {
          await autosave.flush();
          setNote(next);
          setMode('read');
          setCaretAt(null);
          setDirty(false);
          setStatus('saved');
        }}
```

And so must closing the tab. Add this effect beside the others:

```jsx
  // A pending save is the one thing a reload can lose.
  useEffect(() => {
    const onLeave = (e) => {
      if (!autosave.pending()) return;
      autosave.flush();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [autosave]);
```

- [ ] **Step 6: Stop the list reordering under the cursor**

The list sorts by most-recently-edited, so an autosave can lift the open note to the top mid-sentence. Refresh only once writing is done. In `write`, remove any `refresh` call, and add this effect:

```jsx
  // Reordering the list while someone is typing in it moves the row they are
  // looking at. Wait until they are done.
  useEffect(() => {
    if (mode === 'read') refresh(query);
  }, [mode, refresh, query]);
```

- [ ] **Step 7: Show the status**

In `client/src/components/Editor.jsx`, take a `status` prop and replace the `dirty` badge on lines 138-142:

```jsx
          <Badge variant="secondary" className="text-muted-foreground">
            {{ editing: 'Editing', saving: 'Saving…', saved: 'Saved' }[status]}
          </Badge>
```

Add `status` to the signature and pass it down through `NotePane` from `App`. The `Save` button stays exactly as it is — it is still how you save on purpose.

- [ ] **Step 8: Run the tests and the build**

Run: `cd client && npm test && npm run build`
Expected: PASS and a clean build.

- [ ] **Step 9: Verify by hand in a browser**

```bash
export PATH="$HOME/.local/go/bin:$PATH"
cd /home/prathmesh/Projects/note && ./build.sh && ./nib --web --port 4321 --db /tmp/seamless.db
```

1. Type into a note, wait a second, reload the page — the text is there, and no toast fired while typing.
2. The badge reads `Editing` while typing, `Saving…`, then `Saved`.
3. The note does not jump to the top of the list while you are typing in it.
4. Type, then immediately click another note — the first note kept the text.
5. `Esc` after typing restores what was there when you clicked in, and survives a reload.
6. `Ctrl+S` saves and shows the toast.

- [ ] **Step 10: Commit**

```bash
git add -A client/src
git commit -m "save notes as you type"
```

---

## Self-Review

**Spec coverage.** Rendered-until-click → Task 2 Step 5. Markdown source, no live preview → no editor engine anywhere in this plan. `Ctrl+S`/`Esc` kept → Task 2 Step 6. Autosave as a net → Task 3. Block-start cursor → Tasks 1 and 2. `lib/sourceMap.js` → Task 1. Offset-stamped rendering → Task 1 Step 13. Click-walk with a null case → Task 1 Step 9. Save trigger table → Task 3 Steps 5. Status badge → Task 3 Step 7. List reordering → Task 3 Step 6. Every spec test case has a step, except the four in the spec's list that are React-level (`Esc` restores, `Ctrl+S` stays, flush on select, list does not reorder); those are covered by the pure `autosave` suite plus the manual checklists, because adding React Testing Library is a third dev dependency this plan does not spend.

**Deviations from the spec, deliberate.** The spec has `blockSpans` descend into `list.items`; it cannot — a list item's sub-tokens do not tile its `raw` (measured: 101 bytes against 108), so nested bullets collapsed into their parent. Lines carry the offsets instead, and one bullet line is one `<li>` at every depth (verified: 4 spans against 4 `<li>` for a three-deep list, 14 against 14 for a full document). The spec also relies on DOMPurify's `ALLOW_DATA_ATTR`; stamping after sanitising removes that dependency entirely.

**Type consistency.** `blockSpans`, `stampTargets`, `offsetFromClick`, `scrollCaretIntoView` and `createAutosave` are each defined once and used under those names. `caretAt` is an object `{offset}` everywhere, never a bare number — a fresh object each click is what makes clicking the same block twice work.
