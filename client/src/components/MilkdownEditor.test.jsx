import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { replaceAll } from '@milkdown/kit/utils';
import MilkdownEditor from './MilkdownEditor';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mount the component for real: the whole point of it is the editor instance
// it owns, so a shallow render would test nothing.
async function mount(props) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let ready = null;
  const onReady = vi.fn((crepe) => {
    ready = crepe;
  });
  await act(async () => {
    root.render(createElement(MilkdownEditor, { onReady, ...props }));
  });
  // The editor mounts asynchronously; onReady is how anything outside knows.
  await act(async () => {
    await Promise.resolve();
  });
  return {
    host,
    get crepe() {
      return ready;
    },
    rerender: async (next) => {
      await act(async () => {
        root.render(createElement(MilkdownEditor, { onReady, ...props, ...next }));
      });
      await act(async () => {
        await Promise.resolve();
      });
    },
    unmount: async () => {
      await act(async () => root.unmount());
    },
  };
}

const note = (id, content) => ({ id, title: '', content, updated_at: null });

describe('the editor shows the note', () => {
  it('renders its markdown as prose, not as source', async () => {
    const m = await mount({ note: note('a', '# Release checklist\n\nBody text.\n') });
    expect(m.host.querySelector('h1')?.textContent).toBe('Release checklist');
    await m.unmount();
  });

  it('draws an attachment as a player', async () => {
    const m = await mount({ note: note('a', '[demo.mp4](attachments/1111111111111111.mp4)\n') });
    expect(m.host.querySelector('video')).not.toBeNull();
    await m.unmount();
  });
});

describe('changing which note is open', () => {
  it('replaces the text rather than appending to it', async () => {
    const m = await mount({ note: note('a', '# First\n') });
    await m.rerender({ note: note('b', '# Second\n') });
    const text = m.host.textContent;
    expect(text).toContain('Second');
    expect(text).not.toContain('First');
    await m.unmount();
  });
});

describe('edits reach the app', () => {
  it('reports markdown, not ProseMirror', async () => {
    const onChange = vi.fn();
    const open = note('a', '# First\n');
    const m = await mount({ note: open, onChange });

    await act(async () => {
      m.crepe.editor.action(replaceAll('# Second\n\nA new line.\n'));
      // Milkdown debounces markdownUpdated by 200ms.
      await new Promise((r) => setTimeout(r, 320));
    });

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.id).toBe('a');
    expect(last.content).toContain('# Second');
    expect(last.content).toContain('A new line.');
    await m.unmount();
  });
});

describe('leaving the page', () => {
  it('takes the editor with it', async () => {
    const m = await mount({ note: note('a', '# First\n') });
    expect(m.host.querySelector('.ProseMirror')).not.toBeNull();
    await m.unmount();
    expect(m.host.querySelector('.ProseMirror')).toBeNull();
  });
});

describe('the last thing typed is never lost', () => {
  // Milkdown reports changes on a 200ms debounce, so anything typed in that
  // window has not reached the app yet. Closing the note then would drop it,
  // which is the exact failure autosave exists to prevent - so the editor
  // reads its own markdown on the way out rather than trusting the timer.
  it('is reported when the editor closes mid-debounce', async () => {
    const onChange = vi.fn();
    const m = await mount({ note: note('a', '# First\n'), onChange });

    await act(async () => {
      m.crepe.editor.action(replaceAll('# Typed and closed at once\n'));
    });
    // Deliberately no wait: the debounce has not fired.
    expect(onChange).not.toHaveBeenCalled();

    await m.unmount();

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)[0].content).toContain('Typed and closed at once');
  });
});

describe('what does not count as a change', () => {
  it('opening a note reports nothing', async () => {
    // Milkdown fires markdownUpdated once while it loads. Passing that on
    // would mark a note dirty, and save it, for having been looked at.
    const onChange = vi.fn();
    const m = await mount({ note: note('a', '# First\n\nBody.\n'), onChange });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 320));
    });
    expect(onChange).not.toHaveBeenCalled();
    await m.unmount();
  });
});

describe('the editor is not rebuilt while you type', () => {
  it('survives the note prop coming back with new content', async () => {
    // Every autosave hands the note back with the markdown the editor just
    // produced. Rebuilding on that would throw away the cursor mid-sentence
    // and restart whatever video was playing.
    const onReady = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const open = note('a', '# First\n');
    await act(async () => {
      root.render(createElement(MilkdownEditor, { note: open, onReady }));
    });
    await act(async () => await Promise.resolve());
    expect(onReady).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(createElement(MilkdownEditor, {
        note: { ...open, content: '# First\n\nTyped since.\n' },
        onReady,
      }));
    });
    await act(async () => await Promise.resolve());

    // Same instance: the editor was left alone.
    expect(onReady).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});

describe('opening a note and leaving it', () => {
  it('changes nothing, even though the editor tidies whitespace', async () => {
    // The editor normalises as it parses: trailing spaces go, blank lines
    // settle around blocks. That is fine when someone has edited the note -
    // but merely looking at one must not rewrite it, or every note in the
    // database is touched the first time it is opened.
    const onChange = vi.fn();
    const messy = '# Heading\n- a list item   \n\n\n\nsome text \n';
    const m = await mount({ note: note('a', messy), onChange });
    await m.unmount();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('what the app can ask the editor', () => {
  it('says nothing is pending until something is typed', async () => {
    const m = await mount({ note: note('a', '# Heading\n\nsome text   \n') });
    // Opening tidied that trailing whitespace away, but nobody typed, so
    // there is nothing to save. This is what stops Escape or ctrl+S on a
    // note you only looked at from rewriting it.
    expect(m.crepe.pendingMarkdown()).toBeNull();

    await act(async () => {
      m.crepe.editor.action(replaceAll('# Heading\n\nsomething typed\n'));
    });
    expect(m.crepe.pendingMarkdown()).toContain('something typed');
    // And asking twice does not report the same edit twice.
    expect(m.crepe.pendingMarkdown()).toBeNull();
    await m.unmount();
  });
});
