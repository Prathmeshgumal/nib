import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
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

  useEffect(() => {
    const t = setTimeout(() => refresh(query), 200);
    return () => clearTimeout(t);
  }, [query, refresh]);

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

  const save = async () => {
    if (!note) return;
    setSaving(true);
    try {
      const payload = { title: note.title, content: note.content };
      const saved = note.id
        ? await updateNote(note.id, payload)
        : await createNote(payload);
      setDirty(false);
      setNote(saved);
      await refresh(query);
      toast.success(note.id ? 'Note saved' : 'Note created');
      return saved;
    } catch (e) {
      toast.error('Save failed', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  // Clicking the prose is the whole gesture: the note stays put, the pane
  // turns into its source, and the cursor lands where the click did.
  const openAt = (offset) => {
    setBaseline(note.content);
    setMode('write');
    // Always a fresh object, so clicking the same block twice moves the cursor
    // back to it. A null offset still focuses; it just does not aim.
    setCaretAt({ offset });
  };

  // Esc puts back what was there when writing began, so a discard costs
  // nothing more than the switch back to reading.
  const cancel = async () => {
    setCaretAt(null);
    setMode('read');
    if (note.content === baseline) return;
    setNote((n) => ({ ...n, content: baseline }));
    setDirty(false);
  };

  const saveAndRead = async () => {
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
        onSelect={(next) => {
          setNote(next);
          setMode('read');
          setCaretAt(null);
          setDirty(false);
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
              onOpenAt={openAt}
              onChange={(next) => {
                setNote(next);
                setDirty(true);
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
