import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createAutosave } from '@/lib/autosave';
import { toggleTaskAt } from '@/lib/editorActions';
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
  const [mode, setMode] = useState('read');     // 'read' | 'write'
  const [baseline, setBaseline] = useState(''); // content when write mode began
  const [caretAt, setCaretAt] = useState(null); // {offset} for one click
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
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

  // The list sorts by most-recently-edited, so an autosave would lift the open
  // note to the top mid-sentence and move the row being looked at. Hold the
  // refresh until writing is done; leaving write mode runs this again.
  useEffect(() => {
    if (mode === 'write') return;
    const t = setTimeout(() => refresh(query), 200);
    return () => clearTimeout(t);
  }, [query, refresh, mode]);

  useEffect(() => {
    refreshTrash();
  }, [refreshTrash]);

  const startNew = () => {
    setNote(blankNote());
    setBaseline('');
    setMode('write');
    setCaretAt({ offset: 0 });
    setDirty(false);
  };

  // The latest note, readable from a timer that fired before the last render.
  const noteRef = useRef(null);
  noteRef.current = note;

  const write = useCallback(async ({ quiet }) => {
    const current = noteRef.current;
    if (!current) return;
    setStatus('saving');
    setSaving(true);
    try {
      const payload = { title: current.title, content: current.content };
      const saved = current.id
        ? await updateNote(current.id, payload)
        : await createNote(payload);
      setDirty(false);
      setStatus('saved');
      // Keep the id a create just handed back, but not a stale body: the
      // note may have been typed into while the request was in flight.
      setNote((n) => (n ? { ...n, id: saved.id, updated_at: saved.updated_at } : saved));
      if (!quiet) toast.success(current.id ? 'Note saved' : 'Note created');
      return saved;
    } catch (e) {
      setStatus('editing');
      toast.error('Save failed', { description: e.message });
    } finally {
      setSaving(false);
    }
  }, []);

  const autosave = useMemo(
    () => createAutosave({ delay: 800, save: () => write({ quiet: true }) }),
    [write],
  );

  const save = () => write({ quiet: false });

  // A pending save is the one thing a reload can lose. This effect has to sit
  // below `autosave`: its dependency array is read while rendering, so naming
  // `autosave` above the useMemo that builds it is a use-before-init crash.
  useEffect(() => {
    const onLeave = (e) => {
      if (!autosave.pending()) return;
      autosave.flush();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [autosave]);

  // Clicking the prose is the whole gesture: the note stays put, the pane
  // turns into its source, and the cursor lands where the click did.
  const openAt = (offset) => {
    setBaseline(note.content);
    setMode('write');
    // Always a fresh object, so clicking the same block twice moves the cursor
    // back to it. A null offset still focuses; it just does not aim.
    setCaretAt({ offset });
  };

  // Esc puts back what was there when writing began and saves that, so the
  // discard is one more save rather than a second mechanism — and it survives
  // a reload, which matters now that typing alone writes to disk.
  const cancel = async () => {
    autosave.cancel();
    setCaretAt(null);
    setMode('read');
    if (!note || note.content === baseline) return;
    const restored = { ...note, content: baseline };
    setNote(restored);
    setDirty(false);
    setStatus('saving');
    noteRef.current = restored;
    await write({ quiet: true });
  };

  // Ticking a box while reading is a finished act, not a draft, so it saves at
  // once and the note stays rendered. The terminal has no equivalent.
  const toggleTask = async (offset) => {
    const current = noteRef.current;
    if (!current) return;
    const content = toggleTaskAt(current.content, offset);
    if (content === current.content) return;
    const next = { ...current, content };
    setNote(next);
    noteRef.current = next;
    await write({ quiet: true });
  };

  const saveAndRead = async () => {
    autosave.cancel();
    await save();
    setMode('read');
    setCaretAt(null);
  };

  const remove = async (id) => {
    try {
      await deleteNote(id);
      setNote(null);
      setMode('read');
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
      setMode('read');
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
          await autosave.flush();
          setNote(next);
          setMode('read');
          setCaretAt(null);
          setDirty(false);
          setStatus('saved');
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
              mode={mode}
              caretAt={caretAt}
              status={status}
              onOpenAt={openAt}
              onToggleTask={toggleTask}
              onChange={(next) => {
                setNote(next);
                setDirty(true);
                setStatus('editing');
                noteRef.current = next;
                autosave.schedule(next);
              }}
              onSave={saveAndRead}
              onCancel={cancel}
              onDelete={remove}
              saving={saving}
              dirty={dirty || !note.id}
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
