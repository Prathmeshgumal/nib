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
//
// Everything shares the one column width, so the title sits directly above the
// first line of the note however wide the window gets.
//
// It is one row rather than three. The writing is the point of the screen, and
// a title, a timestamp and a badge stacked over a rule spent most of a hundred
// pixels saying things that fit comfortably on a line.
const STATUS = { editing: 'Editing', saving: 'Saving…', saved: 'Saved' };

export default function NotePane({ note, status, onChange, onDelete, onReady }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="mx-auto flex w-full max-w-(--nib-column) items-center gap-3">
        <Input
          value={note.title}
          placeholder="Note title…"
          aria-label="Note title"
          className="h-auto min-w-0 flex-1 border-0 px-0 text-lg font-semibold tracking-tight shadow-none focus-visible:ring-0"
          onChange={(e) => onChange({ ...note, title: e.target.value })}
        />

        <span
          className="text-muted-foreground hidden shrink-0 text-xs sm:inline"
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
          <Button variant="ghost" size="icon" className="shrink-0" aria-label="Delete note">
            <Trash2 className="text-destructive" />
          </Button>
        </DeleteNoteDialog>
      </div>

      <MilkdownEditor note={note} onChange={onChange} onReady={onReady} />
    </div>
  );
}
