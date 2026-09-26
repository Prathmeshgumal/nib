import { describe, expect, it } from 'vitest';
import { tidyEscapes } from './tidyEscapes';

describe('backslashes remark did not need', () => {
  it('leaves a note with no escapes alone', () => {
    const md = '# Heading\n\nplain text\n';
    expect(tidyEscapes(md)).toBe(md);
  });

  it('unescapes an underscore inside a word', () => {
    expect(tidyEscapes('ve\\_hr\n')).toBe('ve_hr\n');
  });

  it('unescapes a tilde that is not a strikethrough', () => {
    expect(tidyEscapes('\\~50 users\n')).toBe('~50 users\n');
  });

  it('unescapes asterisks that never open emphasis', () => {
    expect(tidyEscapes('int \\*\\*ptr2 = \\&ptr;\n')).toBe('int **ptr2 = &ptr;\n');
  });
});

describe('backslashes that are holding the note together', () => {
  it('keeps the one that stops a heading', () => {
    expect(tidyEscapes('\\# not a heading\n')).toBe('\\# not a heading\n');
  });

  it('keeps the one that stops a checkbox', () => {
    const md = '- \\[ ] not a task\n';
    expect(tidyEscapes(md)).toBe(md);
  });

  it('keeps the one that stops emphasis', () => {
    const md = 'a \\*word\\* not in italics\n';
    expect(tidyEscapes(md)).toBe(md);
  });

  it('never touches a literal backslash', () => {
    const md = 'C:\\\\Users\\\\me\n';
    expect(tidyEscapes(md)).toBe(md);
  });
});

describe('a note where only some escapes are safe', () => {
  it('drops the safe one and keeps the rest', () => {
    const md = 've\\_hr\n\n\\# not a heading\n';
    expect(tidyEscapes(md)).toBe('ve_hr\n\n\\# not a heading\n');
  });
});
