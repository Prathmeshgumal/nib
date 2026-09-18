import { Clock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { DeleteNoteDialog } from '@/components/DeleteNoteDialog';
import { renderMarkdown } from '@/lib/markdown';
import { offsetFromClick } from '@/lib/sourceMap';
import { fullTime, relativeTime } from '@/lib/time';

export default function ReadView({ note, onDelete, onOpenAt }) {
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
          // A link is a link first. Let the browser follow it.
          if (e.target.closest('a')) return;
          onOpenAt(offsetFromClick(e.target, e.currentTarget));
        }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}
      />
    </div>
  );
}
