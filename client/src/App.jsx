import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createAutosave } from '@/lib/autosave';
import NoteList from '@/components/NoteList';
import NotePane from '@/components/NotePane';
import EmptyState from '@/components/EmptyState';
import { Card } from '@/components/ui/card';
import { TrashDialog } from '@/components/TrashDialog';
import {
  createNote,
  deleteNote,
  emptyTrash,
  listNotes,
  listTrash,
  purgeNote,
  restoreNote,
  updateNote,
} from '@/lib/api';

const blankNote = () => ({ id: null, title: '', content: '', updated_at: null });

export default function App() {
  const [notes, setNotes] = useState([]);
  const [note, setNote] = useState(null);       // the open note
  const [query, setQuery] = useState('');
  // The one thing that says whether what is on screen has reached the note.
  // There is no separate 'dirty' any more: this is it.
  const [status, setStatus] = useState('saved'); // 'saved' | 'editing' | 'saving'
  const [trash, setTrash] = useState([]);
  const [trashOpen, setTrashOpen] = useState(false);
  // Ids of deletes, newest last, so undo can walk back through them.
  const [deleted, setDeleted] = useState([]);

  const refresh = useCallback(async (q) => {
    try {
      setNotes(await listNotes(q));
    } catch (e) {
      toast.error('Could not load notes', { description: e.message });
    }
  }, []);

  const refreshTrash = useCallback(async () => {
    try {
      setTrash(await listTrash());
    } catch (e) {
      toast.error('Could not load the trash', { description: e.message });
    }
  }, []);

  // The list sorts by most-recently-edited, so refreshing it on every autosave
  // would lift the open note to the top mid-sentence and slide the row being
  // looked at out from under the pointer. It refreshes when the search changes
  // and when the open note changes, and not while a note is being written.
  useEffect(() => {
    const t = setTimeout(() => refresh(query), 200);
    return () => clearTimeout(t);
  }, [query, refresh]);

  useEffect(() => {
    refreshTrash();
  }, [refreshTrash]);

  const startNew = () => {
    setNote(blankNote());
    setStatus('saved');
  };

  // The latest note, readable from a timer that fired before the last render.
  const noteRef = useRef(null);
  noteRef.current = note;

  const write = useCallback(async ({ quiet }) => {
    const current = noteRef.current;
    if (!current) return;
    setStatus('saving');
    try {
      const payload = { title: current.title, content: current.content };
      const saved = current.id
        ? await updateNote(current.id, payload)
        : await createNote(payload);
      setStatus('saved');
      // Keep the id a create just handed back, but not a stale body: the
      // note may have been typed into while the request was in flight.
      setNote((n) => (n ? { ...n, id: saved.id, updated_at: saved.updated_at } : saved));
      if (!quiet) toast.success(current.id ? 'Note saved' : 'Note created');
      return saved;
    } catch (e) {
      setStatus('editing');
      toast.error('Save failed', { description: e.message });
    }
  }, []);

  const autosave = useMemo(
    () => createAutosave({ delay: 800, save: () => write({ quiet: true }) }),
    [write],
  );

  const save = () => write({ quiet: false });

  // The editor itself, once it has started. It reports what was typed on a
  // 200ms debounce of its own, so for the moments where losing a sentence
  // matters - closing the tab, leaving the note, asking for a save outright -
  // the markdown is read straight out of it rather than waited for.
  const editor = useRef(null);

  const syncFromEditor = () => {
    const current = noteRef.current;
    // Null means the editor has nothing the app has not already been told.
    // It answers that itself, because parsing tidies markdown and only the
    // editor knows what the note looked like once it had.
    const markdown = editor.current?.pendingMarkdown?.() ?? null;
    if (!current || markdown === null) return false;
    const next = { ...current, content: markdown };
    noteRef.current = next;
    setNote(next);
    setStatus('editing');
    autosave.schedule(next);
    return true;
  };

  // A pending save is the one thing a reload can lose. This effect has to sit
  // below `autosave`: its dependency array is read while rendering, so naming
  // `autosave` above the useMemo that builds it is a use-before-init crash.
  useEffect(() => {
    const onLeave = (e) => {
      const unreported = syncFromEditor();
      if (!unreported && !autosave.pending()) return;
      autosave.flush();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [autosave]);

  // Ctrl+S has to be caught on the window, not on the textarea. While reading
  // there is no textarea to receive it, so the browser opened Save Page As —
  // which cancels whatever request is in flight and surfaced as a spurious
  // "Could not load notes / Failed to fetch".
  // Ctrl+S no longer closes anything - there is nothing to close. It is the
  // keystroke a hand reaches for to mean "make sure that is safe", so it
  // lands the pending save now instead of waiting out the timer.
  const onSaveKey = useRef(null);
  onSaveKey.current = () => {
    if (!noteRef.current) return undefined;
    syncFromEditor();
    autosave.cancel();
    return save();
  };

  // Escape used to put the note back to how it had been, which is how a key a
  // hand reaches for to mean "I am done here" became a key that could cost an
  // afternoon. The terminal stopped doing that in #27 and this is the other
  // half of it: the writing stays, and Escape just steps out of the text.
  // Taking an edit back is what undo and the thirty-day trash are for.
  const stepOut = () => {
    syncFromEditor();
    autosave.flush();
    document.activeElement?.blur?.();
  };

  const onEscape = useRef(null);
  onEscape.current = stepOut;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onEscape.current?.();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.shiftKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      onSaveKey.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const remove = async (id) => {
    try {
      await deleteNote(id);
      setNote(null);
      setDeleted((d) => [...d, id]);
      await Promise.all([refresh(query), refreshTrash()]);
      toast.success('Moved to trash', {
        action: { label: 'Undo', onClick: () => restore(id) },
      });
    } catch (e) {
      toast.error('Delete failed', { description: e.message });
    }
  };

  // Restoring is shared by the undo action and the trash dialog.
  const restore = async (id) => {
    try {
      const restored = await restoreNote(id);
      setDeleted((d) => d.filter((x) => x !== id));
      await Promise.all([refresh(query), refreshTrash()]);
      setNote(restored);
      toast.success('Restored');
    } catch (e) {
      toast.error('Restore failed', { description: e.message });
    }
  };

  const undoLastDelete = async () => {
    const id = deleted[deleted.length - 1];
    if (!id) {
      toast('Nothing to undo');
      return;
    }
    await restore(id);
  };

  const purge = async (note) => {
    try {
      await purgeNote(note.id);
      setDeleted((d) => d.filter((x) => x !== note.id));
      await refreshTrash();
      toast.success('Deleted for good');
    } catch (e) {
      toast.error('Could not delete the note', { description: e.message });
    }
  };

  const empty = async () => {
    try {
      const { deleted: n } = await emptyTrash();
      setDeleted([]); // those ids are gone; undo has nothing to return to
      await refreshTrash();
      toast.success(`Emptied the trash (${n} ${n === 1 ? 'note' : 'notes'})`);
    } catch (e) {
      toast.error('Could not empty the trash', { description: e.message });
    }
  };

  return (
    <div className="flex h-svh flex-col md:flex-row">
      <NoteList
        notes={notes}
        selectedId={note?.id}
        onSelect={async (next) => {
          // A save waiting on a timer belongs to the note being left, so it
          // has to land before the open note changes under it.
          // Whatever is still sitting in the editor's own debounce belongs to
          // the note being left, not the one being opened.
          syncFromEditor();
          await autosave.flush();
          setNote(next);
                setStatus('saved');
          // Now that the note being written has been left, the list can catch
          // up with what the writing did to it.
          refresh(query);
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
              status={status}
              onChange={(next) => {
                setNote(next);
                setStatus('editing');
                noteRef.current = next;
                autosave.schedule(next);
              }}
              onDelete={remove}
              onReady={(api) => {
                editor.current = api;
              }}
            />
          ) : (
            <EmptyState onNew={startNew} />
          )}
        </Card>
      </main>

      <TrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        trash={trash}
        onRestore={(note) => restore(note.id)}
        onPurge={purge}
        onEmpty={empty}
      />
    </div>
  );
}
