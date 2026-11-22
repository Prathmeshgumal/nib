import { ArrowLeft, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DeleteNoteDialog } from '@/components/DeleteNoteDialog';
import MilkdownEditor from '@/components/MilkdownEditor';
import { fullTime, relativeTime, useMinuteTick } from '@/lib/time';
import { deriveTitle } from '@/lib/noteText';

// A note is one surface now. There is no Edit button and no reading mode to
// come back to: what is on screen is the note, and typing into it is how it
// changes. The chrome here is everything around the writing - the title, when
// it was last touched, whether it is safe, and the way to throw it away.
const STATUS = { editing: 'Editing', saving: 'Saving…', saved: 'Saved' };

// The title and status take a line of their own above the editor's toolbar.
// They used to be laid over the toolbar's right-hand end, but the space kept
// clear for them pushed the toolbar's buttons onto two or three rows at most
// window widths, which cost more height than the line it was meant to save.
export default function NotePane({ note, status, onChange, onDelete, onBack, onReady }) {
  // A note that has never reached the server has nothing to delete and
  // nothing that is "saved" yet.
  const saved = Boolean(note.id);
  useMinuteTick();

  // A note saved without a title is called by its first line, in the list and
  // here alike. Shown as the placeholder, the title line says what the list
  // says while the first line is still being typed, instead of "Untitled".
  const placeholder = deriveTitle('', note.content) || 'Untitled';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Held to the writing's own column, so the title, the toolbar's first
          button and the text all start at the same left edge. */}
      <div className="mx-auto flex w-full max-w-[calc(var(--nib-column)+2*var(--nib-gutter))] items-center gap-2 px-[var(--nib-gutter)]">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 md:hidden pointer-coarse:size-11"
          aria-label="Back to notes"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>

        <Input
          value={note.title}
          placeholder={placeholder}
          aria-label="Note title"
          className="h-8 min-w-0 flex-1 border-0 px-0 text-base font-semibold shadow-none focus-visible:ring-0 md:text-lg dark:bg-transparent"
          onChange={(e) => onChange({ ...note, title: e.target.value, titleEdited: true })}
        />

        <span
          className="text-muted-foreground hidden shrink-0 text-xs sm:inline"
          title={note.updated_at ? fullTime(note.updated_at) : undefined}
        >
          {note.updated_at ? relativeTime(note.updated_at) : 'Not saved yet'}
        </span>

        {/* The one word that says whether what is on screen has reached the
            note. The terminal shows the same two, for the same reason. */}
        {(saved || status !== 'saved') && (
          <Badge variant="outline" className="shrink-0">
            {STATUS[status] ?? 'Saved'}
          </Badge>
        )}

        {saved && (
          <DeleteNoteDialog title={note.title || placeholder} onConfirm={() => onDelete(note.id)}>
            {/* Grey until it is pointed at. In red at rest it was the loudest
                thing on the line, louder than the title. */}
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive focus-visible:text-destructive size-8 shrink-0 pointer-coarse:size-11"
              aria-label="Delete note"
              title="Delete note"
            >
              <Trash2 />
            </Button>
          </DeleteNoteDialog>
        )}
      </div>

      <MilkdownEditor note={note} onChange={onChange} onReady={onReady} />
    </div>
  );
}
