import { describe, expect, it } from 'vitest';
import { deriveTitle, excerpt, unescapeMarkdown } from './noteText';

describe('what a note is called', () => {
  it('leaves a trailing space code out of the title', () => {
    expect(deriveTitle('', 'This is a test&#x20;\n')).toBe('This is a test');
  });

  it('names images in the first line the way a copy does', () => {
    expect(deriveTitle('', 'Fix ![](attachments/0123456789abcdef.png) like ![a b](https://x.com/y.png "t") now\n')).toBe(
      'Fix (image 1) like (image 2) now',
    );
  });

  it('names an image whose name has brackets in it', () => {
    expect(deriveTitle('', 'See ![shot \\[1\\].png](attachments/0123456789abcdef.png) ok\n')).toBe('See (image 1) ok');
  });

  it('uses the title when there is one', () => {
    expect(deriveTitle('Plans', '# Other')).toBe('Plans');
  });

  it('falls back to the first line, the way the store does', () => {
    expect(deriveTitle('', '\n\n## Shopping\nmilk')).toBe('Shopping');
    expect(deriveTitle('  ', 'ASDHOI')).toBe('ASDHOI');
  });

  it('has nothing to offer for an empty note', () => {
    expect(deriveTitle('', '\n  \n')).toBe('');
  });
});

describe('the preview line in the list', () => {
  it('skips the line that is already the title', () => {
    expect(excerpt('# Trip\nbook the train', 'Trip')).toBe('book the train');
  });

  it('does not call a note with only a title empty', () => {
    expect(excerpt('ASDHOI', 'ASDHOI')).toBe('');
    expect(excerpt('', '')).toBe('Empty note');
  });

  it('shows text, not markdown escapes', () => {
    expect(excerpt('C:\\\\temp', 'path')).toBe('C:\\temp');
    expect(unescapeMarkdown('a\\*b')).toBe('a*b');
  });

  it('drops list and task markers', () => {
    expect(excerpt('Title\n- [x] done thing', 'Title')).toBe('done thing');
  });
});

describe('titles of notes with escapes in them', () => {
  it('reads the first line as text, as the store does', () => {
    expect(deriveTitle('', 'ASDHOI\\\\\n')).toBe('ASDHOI\\');
    expect(deriveTitle('', '1\\. not a list')).toBe('1. not a list');
  });
});
