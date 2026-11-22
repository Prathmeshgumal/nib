import { useEffect, useRef } from 'react';
import { FileText, PanelLeftClose, Plus, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ModeToggle } from '@/components/mode-toggle';
import { DeleteNoteDialog } from '@/components/DeleteNoteDialog';
import { relativeTime, useMinuteTick } from '@/lib/time';
import { cn } from '@/lib/utils';

// ⌘ on a Mac, Ctrl everywhere else - the hint has to name the key that works.
const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';
export const SIDEBAR_SHORTCUT = isMac ? '⌘\\' : 'Ctrl+\\';

// One row of the sidebar's actions: icon, words, and anything on the right.
const rowClass =
  'text-foreground/80 hover:bg-accent hover:text-foreground h-8 w-full justify-start gap-2.5 px-2 font-normal pointer-coarse:h-11';

function Kbd({ children }) {
  return (
    <kbd className="text-muted-foreground bg-background ml-auto rounded border px-1.5 font-sans text-[11px] leading-4">
      {children}
    </kbd>
  );
}

export default function NoteList({
  notes,
  selectedId,
  onSelect,
  onNew,
  onDelete,
  query,
  onQuery,
  trashCount,
  onOpenTrash,
  onHide,
  onShow,
  className,
}) {
  useMinuteTick();
  const search = useRef(null);
  const list = useRef(null);

  // Up and down move between notes, and up from the first goes back to the
  // search, the way a list of results does everywhere else.
  const onRowKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...(list.current?.querySelectorAll('[data-note-row]') ?? [])];
    const at = rows.indexOf(e.currentTarget);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? rows[at + 1] : rows[at - 1];
    if (next) next.focus();
    else if (e.key === 'ArrowUp') search.current?.focus();
  };

  // Ctrl+K / ⌘K jumps to the search, from anywhere - the shortcut the hint in
  // the field promises. A put-away sidebar comes back for it first: a hidden
  // field cannot take focus.
  const showRef = useRef(onShow);
  showRef.current = onShow;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      const focus = () => {
        search.current?.focus();
        search.current?.select();
      };
      if (search.current && search.current.offsetParent === null) {
        showRef.current?.();
        // After the sidebar's own focus hand-off, which also waits a frame.
        requestAnimationFrame(() => requestAnimationFrame(focus));
        return;
      }
      focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const count =
    notes === null
      ? null
      : query
        ? `${notes.length} ${notes.length === 1 ? 'match' : 'matches'}`
        : notes.length;

  return (
    <aside
      className={cn(
        'bg-sidebar flex min-h-0 w-full flex-1 flex-col border-r md:w-64 md:flex-none md:shrink-0',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md text-xs font-semibold"
          >
            n
          </span>
          <h1 className="text-sm font-semibold tracking-tight">nib</h1>
        </div>
        <div className="flex items-center gap-0.5">
          {/* Not on a phone: there the list is already a screen of its own. */}
          <Button
            variant="ghost"
            size="icon-sm"
            data-sidebar-close
            className="hidden md:inline-flex"
            aria-label="Hide sidebar"
            aria-keyshortcuts={isMac ? 'Meta+\\' : 'Control+\\'}
            title={`Hide sidebar (${SIDEBAR_SHORTCUT})`}
            onClick={onHide}
          >
            <PanelLeftClose />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 px-2 pb-2">
        {/* Search sits in the list of actions, shaped like the rows around
            it, rather than as a boxed form field above them. */}
        <div className="group/search relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
          <input
            ref={search}
            value={query}
            placeholder="Search"
            aria-label="Search notes"
            aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
            className="placeholder:text-foreground/80 hover:bg-accent focus:bg-background focus:placeholder:text-muted-foreground focus-visible:ring-ring/50 h-8 w-full rounded-md bg-transparent pr-12 pl-8 text-sm outline-none focus:shadow-xs focus-visible:ring-[3px] pointer-coarse:h-11"
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                onQuery('');
                return;
              }
              // Enter opens the best match, and the down arrow walks into the
              // results - instead of tabbing past every action on the way.
              if (e.key === 'Enter' && query && notes?.length) {
                e.preventDefault();
                onSelect(notes[0]);
                return;
              }
              if (e.key === 'ArrowDown' && notes?.length) {
                e.preventDefault();
                list.current?.querySelector('[data-note-row]')?.focus();
              }
            }}
          />
          <span className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2">
            {!query && <Kbd>{MOD} K</Kbd>}
          </span>
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQuery('')}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm outline-none focus-visible:ring-[3px]"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <Button variant="ghost" className={rowClass} onClick={onNew}>
          <Plus /> New note
        </Button>

        <Button variant="ghost" className={rowClass} onClick={onOpenTrash}>
          <Trash2 /> Trash
          {trashCount > 0 && (
            <span className="text-muted-foreground ml-auto text-xs tabular-nums">{trashCount}</span>
          )}
        </Button>
      </div>

      <div className="text-muted-foreground flex items-center justify-between px-4 pt-3 pb-1.5 text-xs font-medium">
        <span>Notes</span>
        <span className="tabular-nums" aria-live="polite">
          {count}
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
        {notes === null ? null : notes.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm">
            <FileText className="size-8 opacity-40" />
            {query ? 'No notes match that search.' : 'No notes yet.'}
          </div>
        ) : (
          <ul ref={list} className="flex flex-col gap-0.5">
            {notes.map((note) => {
              const selected = note.id === selectedId;
              const name = note.title || 'Untitled';
              return (
                <li key={note.id} className="group/row relative">
                  <button
                    type="button"
                    data-note-row
                    onClick={() => onSelect(note)}
                    onKeyDown={onRowKey}
                    aria-current={selected ? 'true' : undefined}
                    title={`${name} · edited ${relativeTime(note.updated_at)}`}
                    className={cn(
                      'text-foreground/80 hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] pointer-coarse:h-11',
                      selected && 'bg-sidebar-active text-foreground hover:bg-sidebar-active pr-9 font-medium pointer-coarse:pr-12'
                    )}
                  >
                    <FileText className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate">{name}</span>
                  </button>
                  {/* Only the open note can be deleted, so the bin always
                      belongs to the note on screen and a stray click on
                      another row cannot throw away something you are not
                      looking at. */}
                  {selected && (
                    <DeleteNoteDialog title={name} onConfirm={() => onDelete(note)}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete “${name}”`}
                        title="Delete note"
                        className="text-muted-foreground hover:text-destructive focus-visible:text-destructive hover:bg-background absolute top-1/2 right-1 size-7 -translate-y-1/2 pointer-coarse:size-10 [&_svg:not([class*='size-'])]:size-3.5"
                      >
                        <Trash2 />
                      </Button>
                    </DeleteNoteDialog>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>

      {/* Settings-like things live at the foot, away from the notes. */}
      <div className="border-t px-2 py-2">
        <ModeToggle className={rowClass} />
      </div>
    </aside>
  );
}
