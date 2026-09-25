import { describe, expect, it } from 'vitest';
import { roundTrip } from './editorConfig';

// attach.Refs, transcribed from internal/attach/ref.go:126. If that regex
// changes, this one has to change with it: it is the whole reason this file
// exists. A reference the editor drops is a file SweepAttachments trashes
// while a note is still using it.
const REF = /(^|[(\s])attachments\/([0-9a-f]{16})\.[a-z0-9]{1,8}/g;
const refs = (md) => [...md.matchAll(REF)].map((m) => m[2]).filter((v, i, a) => a.indexOf(v) === i);

describe('attachments survive a round trip', () => {
  const cases = [
    ['block image', '![diagram](attachments/a1b2c3d4e5f60718.png)\n'],
    ['inline image', 'Inline ![x](attachments/1111111111111111.png) here.\n'],
    ['two images', '![one](attachments/1111111111111111.png)\n\n![two](attachments/2222222222222222.jpg)\n'],
    ['file link', 'See [notes.pdf](attachments/0123456789abcdef.pdf) for the rest.\n'],
    ['video link', 'Watch [demo.mp4](attachments/abcdef0123456789.mp4) now.\n'],
    ['bracketed name', '[a \\[b\\] c](attachments/fedcba9876543210.txt)\n'],
  ];
  for (const [name, md] of cases) {
    it(name, async () => {
      const out = await roundTrip(md);
      expect(refs(out)).toEqual(refs(md));
      expect(out).toBe(md);
    });
  }
});

describe('structure survives a round trip', () => {
  const cases = [
    ['heading', '# Release checklist\n\nBody text.\n'],
    ['task list', '- [ ] rebuild the bundle\n- [x] run the pty suite\n'],
    ['nested list', '- outer\n  - inner\n  - inner two\n'],
    ['fenced code', '```bash\ngo test ./internal/tui/ -v\n```\n'],
    ['inline code', 'The query is `content LIKE ?` today.\n'],
    ['blockquote', '> Autosave landed in #26.\n'],
    ['horizontal rule', 'before\n\n---\n\nafter\n'],
    ['emphasis', 'This is *italic* and **bold** text.\n'],
    ['ampersand and angles', 'Ship A & B when A < B and B > C.\n'],
    ['hash mid-line', 'Fixed in #26 and #27, tag is v1.6.0.\n'],
    ['windows path', 'Look in C:\\Users\\prathmesh\\nib.db today.\n'],
  ];
  for (const [name, md] of cases) {
    it(name, async () => expect(await roundTrip(md)).toBe(md));
  }
});

describe('escaping is idempotent', () => {
  it('does not accumulate backslashes', async () => {
    // It may escape once - store.Unescape takes that back out for search.
    // It must never escape twice, or the note grows a backslash per save.
    const first = await roundTrip('Call store_Open now.\n');
    expect(await roundTrip(first)).toBe(first);
  });
});
