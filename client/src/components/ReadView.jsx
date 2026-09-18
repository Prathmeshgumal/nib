import { Clock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { DeleteNoteDialog } from '@/components/DeleteNoteDialog';
import { renderMarkdown } from '@/lib/markdown';
import { offsetFromClick } from '@/lib/sourceMap';
import { clampWidth, clearSize, setSize } from '@/lib/mediaSize';
import { fullTime, relativeTime } from '@/lib/time';

// startResize follows one drag of a corner grip.
//
// The pointer is captured so the drag keeps up even when it leaves the grip,
// which it does immediately - the grip is 14 pixels and a hand moves faster
// than that. Capture is also what makes a pointer that is released outside the
// window end the drag cleanly rather than leave the page stuck in one.
function startResize(e) {
  const grip = e.target.closest('.nib-grip');
  if (!grip) return false;
  const box = grip.closest('.nib-media');
  const media = box?.querySelector('.nib-sizable');
  const article = grip.closest('article');
  if (!box || !media || !article) return false;

  // The grip sits inside the prose, where a click opens the editor and a drag
  // would otherwise select text across the whole note.
  e.preventDefault();
  e.stopPropagation();

  const name = box.dataset.file;
  const startX = e.clientX;
  const startWidth = media.getBoundingClientRect().width;
  // What the media has to fit inside. Measured once: it cannot change while a
  // pointer is down, and reading it per frame would be a layout on every move.
  const limit = article.clientWidth;

  const move = (ev) => {
    const width = clampWidth(startWidth + (ev.clientX - startX), limit);
    if (width !== null) media.style.width = `${width}px`;
  };
  const end = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', end);
    grip.removeEventListener('pointercancel', end);
    document.body.classList.remove('nib-resizing');
    setSize(name, media.getBoundingClientRect().width);
  };

  grip.setPointerCapture(e.pointerId);
  // While dragging, the whole page shows the resize cursor: the pointer is
  // long gone from the grip, and a cursor that flickers over whatever is
  // underneath makes the drag feel broken.
  document.body.classList.add('nib-resizing');
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  return true;
}

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
        onPointerDown={startResize}
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
          // Double clicking the grip puts the media back to its natural size,
          // which is the way out of a drag that went too far.
          const grip = e.target.closest('.nib-grip');
          if (grip) {
            const box = grip.closest('.nib-media');
            box.querySelector('.nib-sizable')?.style.removeProperty('width');
            clearSize(box.dataset.file);
            return;
          }
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
