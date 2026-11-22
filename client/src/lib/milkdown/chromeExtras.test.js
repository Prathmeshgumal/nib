import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  belowLink,
  flashCopied,
  labelImages,
  labelLinkPreview,
  labelTables,
  markOverflow,
  openableHref,
} from './chromeExtras';

afterEach(() => vi.useRealTimers());

describe('opening a link', () => {
  it('takes a bare domain as the website it was meant as', () => {
    expect(openableHref('example.com')).toBe('https://example.com');
    expect(openableHref('docs.github.com/en/get-started')).toBe('https://docs.github.com/en/get-started');
    expect(openableHref('localhost.dev:8080')).toBe('https://localhost.dev:8080');
  });

  it('leaves a full address alone', () => {
    expect(openableHref('http://example.com')).toBe('http://example.com');
    expect(openableHref('mailto:a@b.co')).toBe('mailto:a@b.co');
  });

  it('turns an email address into a mail link', () => {
    expect(openableHref('someone@example.com')).toBe('mailto:someone@example.com');
  });

  it('keeps links within nib relative', () => {
    expect(openableHref('attachments/abc.png')).toBe('attachments/abc.png');
    expect(openableHref('#heading')).toBe('#heading');
  });

  it('refuses anything that could run script, and nothing at all', () => {
    expect(openableHref('javascript:alert(1)')).toBeNull();
    expect(openableHref(' JavaScript:alert(1)')).toBeNull();
    expect(openableHref('data:text/html,hi')).toBeNull();
    expect(openableHref('')).toBeNull();
  });
});

describe('the Copy button says what happened', () => {
  it('shows Copied, then goes back to Copy', () => {
    vi.useFakeTimers();
    const button = document.createElement('button');
    flashCopied(button, true);
    expect(button.dataset.copied).toBe('yes');
    expect(button.getAttribute('aria-label')).toBe('Copied');
    vi.advanceTimersByTime(2000);
    expect(button.dataset.copied).toBeUndefined();
    expect(button.hasAttribute('aria-label')).toBe(false);
  });

  it('says so when the copy failed', () => {
    const button = document.createElement('button');
    flashCopied(button, false);
    expect(button.dataset.copied).toBe('no');
  });
});

describe('icon buttons get names', () => {
  it('the link preview', () => {
    const root = document.createElement('div');
    root.innerHTML = `<div class="milkdown-link-preview"><div class="link-preview">
      <span class="button link-icon"></span><a class="link-display" href="x.com">x.com</a>
      <span class="button link-edit-button"></span><span class="button link-remove-button"></span></div></div>`;
    labelLinkPreview(root);
    const names = [...root.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'));
    expect(names).toEqual(['Copy link', 'Open link in a new tab', 'Edit link', 'Remove link']);
    expect(root.querySelector('.link-icon').getAttribute('role')).toBe('button');
  });

  it('the table controls', () => {
    const root = document.createElement('div');
    root.innerHTML = `<div class="milkdown-table-block">
      <div data-role="col-drag-handle"><div class="button-group"><button></button><button></button><button></button><button></button></div></div>
      <div data-role="row-drag-handle"><div class="button-group"><button></button></div></div>
      <div data-role="x-line-drag-handle"><button class="add-button"></button></div>
      <div data-role="y-line-drag-handle"><button class="add-button"></button></div></div>`;
    labelTables(root);
    const names = [...root.querySelectorAll('button')].map((e) => e.getAttribute('aria-label'));
    expect(names).toEqual([
      'Align column left',
      'Align column centre',
      'Align column right',
      'Delete column',
      'Delete row',
      'Add a row here',
      'Add a column here',
    ]);
  });
});

describe('the image caption button', () => {
  it('has a name', () => {
    const root = document.createElement('div');
    root.innerHTML = `<div class="milkdown-image-block"><div class="image-wrapper">
      <div class="operation"><div class="operation-item"></div></div></div></div>`;
    labelImages(root);
    const item = root.querySelector('.operation-item');
    expect(item.getAttribute('aria-label')).toBe('Add or hide a caption');
    expect(item.getAttribute('role')).toBe('button');
  });
});

describe('the phone toolbar shows there is more', () => {
  const strip = (scrollLeft, clientWidth, scrollWidth) => {
    const el = document.createElement('div');
    Object.defineProperties(el, {
      scrollLeft: { value: scrollLeft },
      clientWidth: { value: clientWidth },
      scrollWidth: { value: scrollWidth },
    });
    return el;
  };

  it('at the start, more to the right', () => {
    const el = strip(0, 360, 570);
    markOverflow(el);
    expect(el.dataset.more).toBe('right');
  });

  it('in the middle, more both ways', () => {
    const el = strip(100, 360, 570);
    markOverflow(el);
    expect(el.dataset.more).toBe('left right');
  });

  it('at the end, more to the left', () => {
    const el = strip(210, 360, 570);
    markOverflow(el);
    expect(el.dataset.more).toBe('left');
  });

  it('when everything fits, nothing', () => {
    const el = strip(0, 600, 570);
    markOverflow(el);
    expect(el.dataset.more).toBeUndefined();
  });
});

describe('the link preview sits below the link', () => {
  const box = (top, height, styleTop) => {
    const el = document.createElement('div');
    el.style.top = `${styleTop}px`;
    el.getBoundingClientRect = () => ({ top, bottom: top + height });
    return el;
  };

  it('moves down to just under the link', () => {
    // Drawn over the line above: 36px tall, bottom on the link's top at 200.
    expect(belowLink(box(164, 36, 100), { top: 200, bottom: 224 })).toBe(100 + (228 - 164));
  });

  it('stays put once it is there', () => {
    expect(belowLink(box(228, 36, 164), { top: 200, bottom: 224 })).toBeNull();
  });

  it('does nothing while hidden or with no link', () => {
    expect(belowLink(box(0, 0, 0), { top: 200, bottom: 224 })).toBeNull();
    expect(belowLink(box(164, 36, 100), undefined)).toBeNull();
  });
});
