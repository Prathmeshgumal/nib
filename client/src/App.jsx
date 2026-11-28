import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createAutosave } from '@/lib/autosave';
import NoteList from '@/components/NoteList';
import NotePane from '@/components/NotePane';
import EmptyState from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import { editable, savePayload, withSavedName } from '@/lib/notePayload';
import { deriveTitle } from '@/lib/noteText';
import { TrashDialog } from '@/components/TrashDialog';
import { setAttachmentsDir } from '@/lib/milkdown/copyPaths';
import { findLastNote, rememberLastNote } from '@/lib/lastNote';
import {
  health,
  createNote,
  deleteNote,
  emptyTrash,
  listNotes,
  listTrash,
  purgeNote,
  restoreNote,
  updateNote,
} from '@/lib/api';

// `session` names one sitting with a note, and is what the editor is built
// for. It cannot be the id: a new note has none until its first save hands one
// back, and an editor keyed on the id was torn down and rebuilt at that moment
// - taking the cursor with it, a second into the first sentence.
let sessions = 0;
const SIDEBAR_KEY = 'nib-sidebar';

const blankNote = () => ({
  id: null,
  title: '',
  content: '',
  updated_at: null,
  titleEdited: false,
  session: `new-${++sessions}`,
});
const opened = (note) => (note ? { ...editable(note), session: `note-${note.id}-${++sessions}` } : note);

export default function App() {
  // null until the first answer arrives, so the list does not flash "No notes
  // yet" and "0 notes" on every page load.
  const [notes, setNotes] = useState(null);
  const [note, setNote] = useState(null);       // the open note
  const [query, setQuery] = useState('');
  // The one thing that says whether what is on screen has reached the note.
  // There is no separate 'dirty' any more: this is it.
  const [status, setStatus] = useState('saved'); // 'saved' | 'editing' | 'saving'
  const [trash, setTrash] = useState([]);
  const [trashOpen, setTrashOpen] = useState(false);
  // The sidebar can be put away for room to write, on anything wider than a
  // phone (where it is already one screen and the note another). Where it was
  // left is remembered, as a per-browser preference.
  const [sidebarOpen, setSidebarOpenState] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== 'closed';
    } catch {
      return true;
    }
  });
  const setSidebarOpen = useCallback((open) => {
    setSidebarOpenState(open);
    try {
      localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'closed');
    } catch {
      // A private window can refuse storage; the sidebar still toggles.
    }
    // The button just pressed has gone, so focus goes to the one that does
    // the opposite - otherwise it falls back to the page and a keyboard user
    // starts again from the top.
    requestAnimationFrame(() => {
      document.querySelector(open ? '[data-sidebar-close]' : '[data-sidebar-open]')?.focus();
    });
  }, []);
  const sidebarRef = useRef(sidebarOpen);
  sidebarRef.current = sidebarOpen;

  const refresh = useCallback(async (q) => {
    try {
      setNotes(await listNotes(q));
    } catch (e) {
      setNotes((n) => n ?? []);
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
    // The debounce is for typing; the first load has nothing to wait for.
    const t = setTimeout(() => refresh(query), query ? 200 : 0);
    return () => clearTimeout(t);
  }, [query, refresh]);

  useEffect(() => {
    refreshTrash();
  }, [refreshTrash]);

  // Where images live on this machine, so copied text can point at them.
  useEffect(() => {
    health()
      .then((h) => setAttachmentsDir(h?.attachments))
      .catch(() => {});
  }, []);

  // Every tab said "Notes", which is no help with two or three of them open.
  useEffect(() => {
    // A title nobody chose is the first line, as it is in the list.
    document.title = note ? `${deriveTitle(note.title, note.content) || 'Untitled'} · nib` : 'nib';
  }, [note]);

  // A refresh used to land on "No note open", whatever was being written. The
  // note that was open is remembered, and reopened once the first list
  // arrives (issue #60). Until that has happened nothing is remembered: the
  // empty first render would otherwise forget the note before it came back.
  const reopened = useRef(false);
  useEffect(() => {
    if (reopened.current || notes === null) return;
    reopened.current = true;
    // A note started in the moment before the list came back is not replaced.
    if (noteRef.current) return;
    const last = findLastNote(notes);
    if (last) setNote(opened(last));
  }, [notes]);

  useEffect(() => {
    if (reopened.current) rememberLastNote(note?.id ?? null);
  }, [note?.id]);

  const startNew = () => {
    setNote(blankNote());
    setStatus('saved');
  };

  // The latest note, readable from a timer that fired before the last render.
  const noteRef = useRef(null);
  noteRef.current = note;
  const queryRef = useRef(query);
  queryRef.current = query;

  const write = useCallback(async ({ quiet }) => {
    const current = noteRef.current;
    if (!current) return;
    setStatus('saving');
    try {
      // The title goes only once it has been edited here - see notePayload.
      const payload = savePayload(current);
      const saved = current.id
        ? await updateNote(current.id, payload)
        : await createNote(payload);
      setStatus('saved');
      // Keep the id a create just handed back, but not a stale body: the
      // note may have been typed into while the request was in flight.
      setNote((n) => (n ? { ...n, id: saved.id, updated_at: saved.updated_at } : opened(saved)));
      // A note that has just been created is not in the list yet. Every other
      // save leaves the list in its order - see the note on refreshing above -
      // and only gives the saved note its current name.
      if (!current.id) refresh(queryRef.current);
      else setNotes((list) => withSavedName(list, saved));
      if (!quiet) toast.success(current.id ? 'Note saved' : 'Note created');
      return saved;
    } catch (e) {
      setStatus('editing');
      toast.error('Save failed', { description: e.message });
    }
  }, [refresh]);

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

  const onToggleSidebar = useRef(null);
  onToggleSidebar.current = () => setSidebarOpen(!sidebarRef.current);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onEscape.current?.();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl+\ (⌘\ on a Mac) shows and hides the sidebar, as in Notion.
      if (mod && !e.shiftKey && !e.altKey && e.key === '\\') {
        e.preventDefault();
        onToggleSidebar.current?.();
        return;
      }
      if (!mod || e.shiftKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      onSaveKey.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Opening a note, or closing the one that is open (next = null).
  const openNote = async (next) => {
    // A save waiting on a timer belongs to the note being left, so it has to
    // land before the open note changes under it. Whatever is still sitting
    // in the editor's own debounce belongs to the note being left, too.
    syncFromEditor();
    await autosave.flush();
    setNote(opened(next));
    setStatus('saved');
    // Now that the note being written has been left, the list can catch up
    // with what the writing did to it.
    refresh(query);
  };

  // Any note can be deleted from its row in the sidebar, not only the open
  // one. Deleting the open note lands what is still being typed first, so the
  // copy in the trash - and the one undo brings back - is the latest.
  const remove = async (id) => {
    const isOpen = noteRef.current?.id === id;
    try {
      if (isOpen) {
        syncFromEditor();
        await autosave.flush();
      }
      await deleteNote(id);
      if (isOpen) setNote(null);
      await Promise.all([refresh(query), refreshTrash()]);
      toast.success('Moved to trash', {
        action: { label: 'Undo', onClick: () => restore(id) },
      });
    } catch (e) {
      toast.error('Delete failed', { description: e.message });
    }
  };

  // Restoring is shared by the undo action and the trash dialog. The note
  // comes back open, so the trash closes to show it rather than sitting in
  // front of it.
  const restore = async (id) => {
    try {
      const restored = await restoreNote(id);
      await Promise.all([refresh(query), refreshTrash()]);
      setTrashOpen(false);
      setNote(opened(restored));
      toast.success('Restored');
    } catch (e) {
      toast.error('Restore failed', { description: e.message });
    }
  };

  const purge = async (note) => {
    try {
      await purgeNote(note.id);
      await refreshTrash();
      toast.success('Deleted for good');
    } catch (e) {
      toast.error('Could not delete the note', { description: e.message });
    }
  };

  const empty = async () => {
    try {
      const { deleted: n } = await emptyTrash();
      await refreshTrash();
      toast.success(`Emptied the trash (${n} ${n === 1 ? 'note' : 'notes'})`);
    } catch (e) {
      toast.error('Could not empty the trash', { description: e.message });
    }
  };

  return (
    <div className="flex h-svh flex-col md:flex-row">
      <NoteList
        // On a phone there is room for the list or the note, not both.
        // Wider than that, it is there unless it has been put away.
        className={cn(note && 'hidden', sidebarOpen ? 'md:flex' : 'md:hidden')}
        onHide={() => setSidebarOpen(false)}
        onShow={() => setSidebarOpen(true)}
        notes={notes}
        selectedId={note?.id}
        onSelect={openNote}
        onNew={startNew}
        onDelete={(n) => remove(n.id)}
        query={query}
        onQuery={setQuery}
        trashCount={trash.length}
        onOpenTrash={() => setTrashOpen(true)}
      />

      {/* The note is the page, not a card laid on it: the sidebar's tint and
          one line between them are all the separation it needs. */}
      <main
        className={cn(
          'bg-card min-h-0 min-w-0 flex-1 flex-col md:flex',
          note ? 'flex' : 'hidden'
        )}
      >
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
            onBack={() => openNote(null)}
            sidebarOpen={sidebarOpen}
            onShowSidebar={() => setSidebarOpen(true)}
            onReady={(api) => {
              editor.current = api;
            }}
          />
        ) : (
          <EmptyState
            onNew={startNew}
            sidebarOpen={sidebarOpen}
            onShowSidebar={() => setSidebarOpen(true)}
          />
        )}
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
