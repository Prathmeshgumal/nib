import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DeleteNoteDialog } from '@/components/DeleteNoteDialog';
import MilkdownEditor from '@/components/MilkdownEditor';
import { fullTime, relativeTime } from '@/lib/time';

// A note is one surface now. There is no Edit button and no reading mode to
// come back to: what is on screen is the note, and typing into it is how it
// changes. The chrome here is everything around the writing - the title, when
// it was last touched, whether it is safe, and the way to throw it away.
const STATUS = { editing: 'Editing', saving: 'Saving…', saved: 'Saved' };

function Meta({ note, status, onChange, onDelete }) {
  return (
    <>
      <Input
        value={note.title}
        placeholder="Note title…"
        aria-label="Note title"
        className="h-7 min-w-0 flex-1 border-0 px-0 text-right text-sm font-medium shadow-none focus-visible:ring-0"
        onChange={(e) => onChange({ ...note, title: e.target.value })}
      />

      <span
        className="text-muted-foreground hidden shrink-0 text-xs md:inline"
        title={note.updated_at ? fullTime(note.updated_at) : undefined}
      >
        {note.updated_at ? relativeTime(note.updated_at) : 'Not saved yet'}
      </span>

      {/* The one word that says whether what is on screen has reached the
          note. The terminal shows the same two, for the same reason. */}
      <Badge variant="outline" className="shrink-0">
        {STATUS[status] ?? 'Saved'}
      </Badge>

      <DeleteNoteDialog title={note.title} onConfirm={() => onDelete(note.id)}>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Delete note">
          <Trash2 className="text-destructive" />
        </Button>
      </DeleteNoteDialog>
    </>
  );
}

// Where the title and status go depends on whether there is room for them.
//
// Wide enough, and they sit at the right-hand end of the editor's own toolbar,
// which is mostly empty there - so they cost the writing no vertical space at
// all. They are laid over the bar rather than put inside it, because the bar
// belongs to Milkdown; the bar is given matching right padding in crepe.css so
// no button can ever end up underneath them.
//
// Narrow, and that trade stops paying: reserving a third of the bar for them
// pushes its buttons into four or five wrapped rows, which costs far more than
// the row it saved. So below `lg` they take a line of their own.
export default function NotePane({ note, status, onChange, onDelete, onReady }) {
  const meta = { note, status, onChange, onDelete };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-2 lg:gap-0 lg:[--nib-meta:21rem]">
      <div className="flex items-center gap-2 lg:hidden">
        <Meta {...meta} />
      </div>

      {/* h-11 is the toolbar's own min-height, which is what puts these on its
          line. The strip ignores pointer events so the bar stays clickable
          underneath it; the cluster itself takes them back. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 hidden h-11 items-center justify-end lg:flex">
        <div className="bg-popover pointer-events-auto flex w-(--nib-meta) min-w-0 items-center justify-end gap-2 pr-1 pl-4">
          <Meta {...meta} />
        </div>
      </div>

      <MilkdownEditor note={note} onChange={onChange} onReady={onReady} />
    </div>
  );
}
