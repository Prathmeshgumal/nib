import { useEffect, useRef } from 'react';
import '@/lib/milkdown/crepe.css';
import { createEditor } from '@/lib/milkdown/editorConfig';
import { tidyEscapes } from '@/lib/milkdown/tidyEscapes';
import { uploadAttachment } from '@/lib/api';

// The note, as one surface. There is no read mode and no write mode any more:
// what is on screen is the note, and typing into it is how it changes.
//
// The editor instance is built once per note and torn down with it. It is
// keyed on the note's id rather than its text, because rebuilding on every
// keystroke would throw the cursor away - and stop whatever video was playing.
export default function MilkdownEditor({ note, onChange, onReady }) {
  const host = useRef(null);
  // Read from inside the editor's own callbacks, which outlive the render that
  // registered them.
  const latest = useRef({ note, onChange });
  latest.current = { note, onChange };

  useEffect(() => {
    const root = host.current;
    if (!root) return undefined;

    let crepe = null;
    let thrownAway = false;
    // What the app has been told, and the yardstick the close below measures
    // against. It is set from the editor once it has started rather than from
    // the note, because parsing tidies markdown as it goes - trailing spaces
    // dropped, blank lines settled around blocks. Measuring against the note
    // would make every one of those look like an edit, and simply opening a
    // note would rewrite it.
    let reported = note.content ?? '';

    // A dropped or pasted file goes to nib's own attachment store and comes
    // back as the relative link the terminal already understands.
    //
    // `stored`, not `name`: the store keeps a file under a hash of its
    // contents plus the extension it settled on, while `name` is what the file
    // was called on the way in and exists to be link text. Building the URL
    // out of `name` points at a file that was never written, which is an image
    // that loads as a broken box.
    const onUpload = async (file) => {
      const { stored } = await uploadAttachment(file);
      return `attachments/${stored}`;
    };

    crepe = createEditor(root, { markdown: note.content ?? '', onUpload });

    // Everything the editor hands out goes through here, so the note and the
    // yardstick below are always the same flavour of markdown - otherwise the
    // tidying would itself read as an edit on the very next comparison.
    const read = () => tidyEscapes(crepe.getMarkdown());
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, previous) => {
        // Two different documents can serialize to the same markdown - a
        // selection tidied up, a node split and rejoined - and reporting one
        // of those would mark a note dirty for having been looked at.
        //
        // Loading is already safe without a guard here: the listener only
        // fires once it has a previous document to compare against, so
        // opening a note is silent.
        if (markdown === previous) return;
        const tidied = tidyEscapes(markdown);
        reported = tidied;
        const current = latest.current;
        current.onChange?.({ ...current.note, content: tidied });
      });
    });

    crepe
      .create()
      .then(() => {
        // Unmounted while it was still starting: throw it away rather than
        // leave an editor attached to a node React has already dropped.
        if (thrownAway) {
          crepe.destroy();
          return;
        }
        // The note as the editor holds it: anything different from here on is
        // something the typist did.
        try {
          reported = read();
        } catch {
          // Leave the note's own text as the yardstick.
        }
        // What the app gets is not the editor but one question it can ask:
        // "is there anything you have not told me yet?" Keeping the yardstick
        // in here is what stops every caller having to know that parsing
        // tidies markdown.
        onReady?.({
          // The editor itself, for anything that needs to reach ProseMirror.
          editor: crepe.editor,
          pendingMarkdown() {
            let markdown;
            try {
              markdown = read();
            } catch {
              return null;
            }
            if (markdown === reported) return null;
            reported = markdown;
            return markdown;
          },
        });
      })
      .catch(() => {
        // A note that will not open is worth saying so about, but it must not
        // take the app down with it.
      });

    return () => {
      thrownAway = true;
      // Anything typed inside the debounce window has not been reported yet.
      // Reading the editor directly on the way out is what stops the last
      // sentence of a note being lost to a closed tab or a switched note -
      // the failure autosave exists to prevent in the first place.
      try {
        const last = crepe ? read() : undefined;
        if (last !== undefined && last !== reported) {
          const current = latest.current;
          current.onChange?.({ ...current.note, content: last });
        }
      } catch {
        // An editor that never finished starting has nothing to hand back.
      }
      crepe?.destroy();
    };
    // Deliberately not note.content: see the note above about the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  return <div ref={host} className="nib-editor min-h-0 flex-1 overflow-y-auto" />;
}
