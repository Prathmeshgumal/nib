import { Clock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { DeleteNoteDialog } from '@/components/DeleteNoteDialog';
import { renderMarkdown } from '@/lib/markdown';
import { offsetFromClick } from '@/lib/sourceMap';
import { fullTime, relativeTime } from '@/lib/time';

export default function ReadView({ note, onDelete, onOpenAt, onToggleTask }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight">{note.title}</h2>
          <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
            <Clock className="size-3.5" />
            <span title={fullTime(note.updated_at)}>
              Updated {relativeTime(note.updated_at)}
            </span>
            <Badge variant="outline" className="ml-1">Saved</Badge>
            {/* A single click no longer opens the editor, so say what does. */}
            <span className="ml-1 hidden sm:inline">· Double-click to edit</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DeleteNoteDialog title={note.title} onConfirm={() => onDelete(note.id)}>
            <Button variant="outline" size="icon" aria-label="Delete note">
              <Trash2 className="text-destructive" />
            </Button>
          </DeleteNoteDialog>
        </div>
      </div>

      <Separator />

      {/* Clicking the prose is how you start writing; there is no Edit button. */}
      <article
        className="prose prose-zinc dark:prose-invert min-h-0 max-w-none flex-1 cursor-text overflow-y-auto pb-6"
        onClick={(e) => {
          // Ticking a box is a single click, because it is the one gesture in
          // the rendered note that is not about editing text.
          if (e.target.matches('input[type="checkbox"]')) {
            const at = offsetFromClick(e.target, e.currentTarget);
            if (at !== null) onToggleTask(at);
          }
          // Everything else does nothing: a single click is for reading,
          // selecting and following links.
        }}
        onDoubleClick={(e) => {
          // A link is a link first. Let the browser follow it.
          if (e.target.closest('a')) return;
          if (e.target.matches('input[type="checkbox"]')) return;
          // The double click has just selected a word; the caret we are about
          // to set is the one that matters.
          window.getSelection()?.removeAllRanges();
          onOpenAt(offsetFromClick(e.target, e.currentTarget));
        }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}
      />
    </div>
  );
}
