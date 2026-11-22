import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import MilkdownEditor from '@/components/MilkdownEditor';
import { fullTime, relativeTime, useMinuteTick } from '@/lib/time';
import { deriveTitle } from '@/lib/noteText';

// A note is one surface now. There is no Edit button and no reading mode to
// come back to: what is on screen is the note, and typing into it is how it
// changes. The chrome here is everything around the writing - the title, when
// it was last touched and whether it is safe. Throwing it away lives on its
// row in the sidebar, next to every other note's.
const STATUS = { editing: 'Editing', saving: 'Saving…', saved: 'Saved' };
const DOT = { editing: 'bg-pending', saving: 'bg-muted-foreground animate-pulse', saved: 'bg-ok' };

// The title and status take a line of their own above the editor's toolbar.
// They used to be laid over the toolbar's right-hand end, but the space kept
// clear for them pushed the toolbar's buttons onto two or three rows at most
// window widths, which cost more height than the line it was meant to save.
export default function NotePane({ note, status, onChange, onBack, onReady }) {
  // A note that has never reached the server has nothing that is "saved" yet.
  const saved = Boolean(note.id);
  useMinuteTick();

  // A note saved without a title is called by its first line, in the list and
  // here alike. Shown as the placeholder, the title line says what the list
  // says while the first line is still being typed, instead of "Untitled".
  const placeholder = deriveTitle('', note.content) || 'Untitled';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-13 shrink-0 items-center gap-3 border-b px-3 sm:px-6 pointer-coarse:h-14">
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
          className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-[15px] font-semibold shadow-none focus-visible:ring-0 md:text-[15px] dark:bg-transparent"
          onChange={(e) => onChange({ ...note, title: e.target.value, titleEdited: true })}
        />

        <span
          className="text-muted-foreground hidden shrink-0 text-xs lg:inline"
          title={note.updated_at ? fullTime(note.updated_at) : undefined}
        >
          {note.updated_at ? relativeTime(note.updated_at) : 'Not saved yet'}
        </span>

        {/* The one word that says whether what is on screen has reached the
            note, with a dot to find it at a glance. The terminal shows the
            same words, for the same reason. */}
        {(saved || status !== 'saved') && (
          <span
            role="status"
            className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs"
          >
            <span aria-hidden="true" className={cn('size-1.5 rounded-full', DOT[status] ?? DOT.saved)} />
            {STATUS[status] ?? 'Saved'}
          </span>
        )}
      </header>

      <MilkdownEditor note={note} onChange={onChange} onReady={onReady} />
    </div>
  );
}
