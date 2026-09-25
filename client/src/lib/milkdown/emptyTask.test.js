import { describe, expect, it } from 'vitest';
import { roundTrip } from './editorConfig';

describe('an empty to-do stays a to-do', () => {
  const cases = [
    ['on its own', '- [ ]\n'],
    ['with a trailing space, as a person leaves it', '- [ ] \n'],
    ['a ticked empty one', '- [x]\n'],
    ['among items that have text', '- [ ] rebuild the bundle\n- [ ]\n- [x] run the suite\n'],
  ];
  for (const [name, md] of cases) {
    it(name, async () => {
      const out = await roundTrip(md);
      // It must still be a checkbox: never `- \[ ]`, which is literal text.
      expect(out).not.toContain('\\[');
      expect(out).toMatch(/^[-*] \[[ x]\]/m);
    });
  }

  it('leaves a real escaped bracket alone', async () => {
    // Someone writing about markdown, rather than writing a to-do.
    const md = '- \\[not a checkbox]\n';
    expect(await roundTrip(md)).toBe(md);
  });
});
