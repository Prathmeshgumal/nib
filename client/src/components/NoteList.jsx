import { FileText, NotebookPen, Plus, Search, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ModeToggle } from '@/components/mode-toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

function excerpt(content) {
  const line = (content || '')
    .split('\n')
    .map((l) => l.replace(/^[#>\-*\d.\s`]+/, '').trim())
    .find(Boolean);
  return line ? line.slice(0, 90) : 'Empty note';
}

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
}) {
  return (
    <aside className="bg-muted flex w-full shrink-0 flex-col border-r md:w-80">
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
            className="bg-background pl-8"
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3 pb-3">
        {notes.length === 0 ? (
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
                  <div className="truncate text-sm font-medium">{note.title}</div>
                  <div className="text-muted-foreground mt-0.5 truncate text-xs">
                    {excerpt(note.content)}
                  </div>
                  <div className="text-muted-foreground/80 mt-1.5 text-[11px]">
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
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}
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
