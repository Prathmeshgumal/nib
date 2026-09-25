import { describe, expect, it } from 'vitest';
import { roundTripWithAttachments as roundTrip } from './editorConfig';

// attach.Refs, transcribed from internal/attach/ref.go:126.
const REF = /(^|[(\s])attachments\/([0-9a-f]{16})\.[a-z0-9]{1,8}/g;
const refs = (md) => [...md.matchAll(REF)].map((m) => m[2]).filter((v, i, a) => a.indexOf(v) === i);

// The node claims these and renders them as a block. Whatever it draws, the
// markdown it writes back has to be the markdown it was given: this is the
// pattern that destroyed the alt text in the image component, so it is pinned
// harder than anything else in the editor.
describe('attachment links survive becoming a block', () => {
  const cases = [
    ['a pdf mid-sentence', 'See [notes.pdf](attachments/0123456789abcdef.pdf) for the rest.\n'],
    ['a video mid-sentence', 'Watch [demo.mp4](attachments/abcdef0123456789.mp4) now.\n'],
    ['audio', 'Here is [take-3.m4a](attachments/1111111111111111.m4a).\n'],
    ['a whole paragraph', '[recording.webm](attachments/2222222222222222.webm)\n'],
    ['a docx', 'The [brief.docx](attachments/3333333333333333.docx) is attached.\n'],
    ['a container no browser decodes', '[raw.mkv](attachments/4444444444444444.mkv)\n'],
    ['brackets in the name', '[a \\[b\\] c](attachments/fedcba9876543210.txt)\n'],
    ['two on one line', '[a.pdf](attachments/5555555555555555.pdf) and [b.mp4](attachments/6666666666666666.mp4)\n'],
    ['one in a list item', '- [notes.pdf](attachments/7777777777777777.pdf)\n'],
  ];
  for (const [name, md] of cases) {
    it(name, async () => {
      const out = await roundTrip(md);
      expect(refs(out)).toEqual(refs(md));
      expect(out).toBe(md);
    });
  }
});

// Anything it cannot represent faithfully it must leave alone, rather than
// flatten into a block and lose what it could not carry.
describe('what the node refuses to claim', () => {
  const cases = [
    ['an ordinary web link', 'Read [the docs](https://example.com/a) today.\n'],
    ['a link to a path that only looks like one', 'See [x](other/0123456789abcdef.pdf) now.\n'],
    ['an image, which the image nodes own', '![diagram](attachments/a1b2c3d4e5f60718.png)\n'],
    ['an inline image', 'Inline ![x](attachments/9999999999999999.png) here.\n'],
  ];
  for (const [name, md] of cases) {
    it(name, async () => expect(await roundTrip(md)).toBe(md));
  }
});

// A link carrying a mark is left as a link. The mark moves outside it on the
// way back out, which is Milkdown normalising every link the same way - see
// the mark-ordering test in roundTrip.test.js - and renders identically. What
// matters here is that it stayed a link instead of being flattened into a
// block that had nowhere to put the bold.
describe('a formatted attachment link stays a link', () => {
  it('keeps its reference and its text', async () => {
    const md = 'See [**the brief**](attachments/8888888888888888.pdf) now.\n';
    const out = await roundTrip(md);
    expect(out).toBe('See **[the brief](attachments/8888888888888888.pdf)** now.\n');
    expect(refs(out)).toEqual(refs(md));
  });
});
