import { FileText, NotebookPen, Plus, Search, Trash2, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ModeToggle } from '@/components/mode-toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { relativeTime, useMinuteTick } from '@/lib/time';
import { cn } from '@/lib/utils';
import { excerpt } from '@/lib/noteText';

export default function NoteList({
  notes,
  selectedId,
  onSelect,
  onNew,
  query,
  onQuery,
  trashCount,
  onOpenTrash,
  canUndo,
  onUndo,
  className,
}) {
  useMinuteTick();
  return (
    <aside
      className={cn(
        'bg-muted flex min-h-0 w-full flex-1 flex-col border-r md:w-80 md:flex-none md:shrink-0',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <NotebookPen className="size-5" />
          <h1 className="text-base font-semibold tracking-tight">Notes</h1>
        </div>
        <ModeToggle />
      </div>
      <Separator />

      <div className="space-y-3 p-3">
        <Button className="w-full" onClick={onNew}>
          <Plus /> New note
        </Button>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={query}
            placeholder="Search notes…"
            aria-label="Search notes"
            className="bg-background pr-8 pl-8"
            onChange={(e) => onQuery(e.target.value)}
          />
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
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3 pb-3">
        {notes === null ? null : notes.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm">
            <FileText className="size-8 opacity-40" />
            {query ? 'No notes match that search.' : 'No notes yet.'}
          </div>
        ) : (
          <ul className="space-y-1">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  onClick={() => onSelect(note)}
                  className={cn(
                    'hover:bg-accent focus-visible:ring-ring/50 w-full rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-[3px]',
                    note.id === selectedId && 'bg-background border-border shadow-xs'
                  )}
                >
                  <div className="truncate text-sm font-medium">{note.title || 'Untitled'}</div>
                  {/* An empty line keeps a title-only note the same height as
                      its neighbours, so the list does not jump. */}
                  <div className="text-muted-foreground mt-0.5 min-h-4 truncate text-xs">
                    {excerpt(note.content, note.title)}
                  </div>
                  {/* Full strength: at 11px the faded grey fell under 4.5:1. */}
                  <div className="text-muted-foreground mt-1.5 text-xs">
                    {relativeTime(note.updated_at)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      <Separator />
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-muted-foreground pl-1 text-xs">
          {notes !== null &&
            (query
              ? `${notes.length} ${notes.length === 1 ? 'match' : 'matches'}`
              : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`)}
        </span>
        <div className="flex items-center gap-1">
          {canUndo && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={onUndo} aria-label="Undo delete">
                  <Undo2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo delete</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onOpenTrash}
                aria-label="Open the trash"
                className="text-muted-foreground gap-1.5"
              >
                <Trash2 />
                {trashCount > 0 && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
                    {trashCount}
                  </Badge>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Trash</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
