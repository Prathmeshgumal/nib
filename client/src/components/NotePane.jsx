import { Clock, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { DeleteNoteDialog } from '@/components/DeleteNoteDialog';
import MilkdownEditor from '@/components/MilkdownEditor';
import { fullTime, relativeTime } from '@/lib/time';

// A note is one surface now. There is no Edit button and no reading mode to
// come back to: what is on screen is the note, and typing into it is how it
// changes. The chrome here is everything around the writing - the title, when
// it was last touched, whether it is safe, and the way to throw it away.
//
// Everything shares the one column width, so the title sits directly above the
// first line of the note however wide the window gets.
const STATUS = { editing: 'Editing', saving: 'Saving…', saved: 'Saved' };

export default function NotePane({ note, status, onChange, onDelete, onReady }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="mx-auto flex w-full max-w-(--nib-column) flex-wrap items-start justify-between gap-3">
        <Input
          value={note.title}
          placeholder="Note title…"
          aria-label="Note title"
          className="h-auto min-w-0 flex-1 border-0 px-0 text-xl font-semibold tracking-tight shadow-none focus-visible:ring-0"
          onChange={(e) => onChange({ ...note, title: e.target.value })}
        />
        <div className="flex items-center gap-2">
          <DeleteNoteDialog title={note.title} onConfirm={() => onDelete(note.id)}>
            <Button variant="outline" size="icon" aria-label="Delete note">
              <Trash2 className="text-destructive" />
            </Button>
          </DeleteNoteDialog>
        </div>
      </div>

      <div className="text-muted-foreground mx-auto flex w-full max-w-(--nib-column) items-center gap-1.5 text-xs">
        <Clock className="size-3.5" />
        <span title={note.updated_at ? fullTime(note.updated_at) : undefined}>
          {note.updated_at ? `Updated ${relativeTime(note.updated_at)}` : 'Not saved yet'}
        </span>
        {/* The one word that says whether what is on screen has reached the
            note. The terminal shows the same two, for the same reason. */}
        <Badge variant="outline" className="ml-1">
          {STATUS[status] ?? 'Saved'}
        </Badge>
      </div>

      <Separator />

      <MilkdownEditor note={note} onChange={onChange} onReady={onReady} />
    </div>
  );
}
