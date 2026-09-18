import { describe, expect, it } from 'vitest';
import {
  isViewable, kindOf, rawHref, storedName, viewerHref, viewerRoute,
} from './attachments';

describe('kindOf', () => {
  it('knows the image types markdown already renders inline', () => {
    for (const n of ['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg']) {
      expect(kindOf(n)).toBe('image');
    }
  });

  it('knows the video types a browser can play', () => {
    for (const n of ['a.mp4', 'a.webm', 'a.mov', 'a.m4v']) {
      expect(kindOf(n)).toBe('video');
    }
  });

  it('separates containers no browser decodes', () => {
    for (const n of ['a.mkv', 'a.avi', 'a.wmv']) {
      expect(kindOf(n)).toBe('film');
    }
  });

  it('knows the audio types', () => {
    for (const n of ['a.mp3', 'a.m4a', 'a.wav', 'a.flac']) {
      expect(kindOf(n)).toBe('audio');
    }
  });

  it('calls ogg audio, which is the commoner intent', () => {
    expect(kindOf('a.ogg')).toBe('audio');
    expect(kindOf('a.ogv')).toBe('video');
  });

  it('names the document types the viewer handles', () => {
    expect(kindOf('a.docx')).toBe('docx');
    expect(kindOf('a.pdf')).toBe('pdf');
    expect(kindOf('a.csv')).toBe('csv');
    expect(kindOf('a.md')).toBe('markdown');
    expect(kindOf('a.json')).toBe('text');
    expect(kindOf('a.go')).toBe('text');
  });

  it('falls back to a plain file for anything else', () => {
    for (const n of ['a.zip', 'a.doc', 'a.pptx', 'a.epub', 'a.bin', 'a', '']) {
      expect(kindOf(n)).toBe('file');
    }
  });

  it('ignores a dot that is not an extension', () => {
    expect(kindOf('my.holiday.photo.png')).toBe('image');
  });
});

describe('isViewable', () => {
  it('sends documents to the viewer tab', () => {
    expect(isViewable('a.docx')).toBe(true);
    expect(isViewable('a.csv')).toBe(true);
    expect(isViewable('a.md')).toBe(true);
  });

  it('keeps playable media out of it, because those play in the note', () => {
    expect(isViewable('a.mp4')).toBe(false);
    expect(isViewable('a.mp3')).toBe(false);
  });

  it('leaves the PDF to the browser, which has a better viewer', () => {
    expect(isViewable('a.pdf')).toBe(false);
  });

  it('sends an undecodable video there to explain itself', () => {
    expect(isViewable('a.mkv')).toBe(true);
  });

  it('leaves a file we can show nothing for alone', () => {
    expect(isViewable('a.zip')).toBe(false);
    expect(isViewable('a.pptx')).toBe(false);
  });
});

describe('storedName', () => {
  const name = '54d071396a02facc.docx';

  it('reads the name out of an attachment href', () => {
    expect(storedName(`attachments/${name}`)).toBe(name);
  });

  it('refuses a remote URL that ends the same way', () => {
    expect(storedName(`https://elsewhere.test/attachments/${name}`)).toBe(null);
  });

  it('refuses a path with a directory in it', () => {
    expect(storedName('attachments/nested/54d071396a02facc.docx')).toBe(null);
  });

  it('refuses a name that is not the stored shape', () => {
    expect(storedName('attachments/report.docx')).toBe(null);
    expect(storedName('attachments/54d071396a02fac.docx')).toBe(null); // 15 hex
  });

  it('refuses an empty or missing href', () => {
    expect(storedName('')).toBe(null);
    expect(storedName(undefined)).toBe(null);
  });
});

describe('hrefs', () => {
  it('builds absolute paths, so they resolve from /view/ too', () => {
    expect(viewerHref('abc.docx')).toBe('/view/abc.docx');
    expect(rawHref('abc.docx')).toBe('/attachments/abc.docx');
  });

  it('carries the readable filename along as a label', () => {
    expect(viewerHref('abc.docx', 'Q3 report.docx'))
      .toBe('/view/abc.docx?name=Q3%20report.docx');
  });
});

describe('viewerRoute', () => {
  const name = '54d071396a02facc.docx';

  it('recognises the viewer path and reads the label back', () => {
    expect(viewerRoute(`/view/${name}`, '?name=Q3%20report.docx'))
      .toEqual({ name, label: 'Q3 report.docx' });
  });

  it('falls back to the name on disk when there is no label', () => {
    expect(viewerRoute(`/view/${name}`)).toEqual({ name, label: name });
  });

  it('is not the viewer anywhere else', () => {
    expect(viewerRoute('/')).toBe(null);
    expect(viewerRoute('/view/')).toBe(null);
    expect(viewerRoute('/view/report.docx')).toBe(null);
    expect(viewerRoute(`/view/${name}/extra`)).toBe(null);
    expect(viewerRoute(`/attachments/${name}`)).toBe(null);
  });
});
