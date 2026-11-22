import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, PanelLeftOpen } from 'lucide-react';
import { SIDEBAR_SHORTCUT } from '@/components/NoteList';
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
export default function NotePane({ note, status, onChange, onBack, onReady, sidebarOpen = true, onShowSidebar }) {
  // A note that has never reached the server has nothing that is "saved" yet.
  const saved = Boolean(note.id);
  useMinuteTick();

  // A note saved without a title is called by its first line, in the list and
  // here alike. Shown as the placeholder, the title line says what the list
  // says while the first line is still being typed, instead of "Untitled".
  const derived = deriveTitle('', note.content);
  const placeholder = derived || 'Untitled';

  // The whole note for Claude Code, images as files. The button says what
  // happened for a moment, the way a code block's Copy does.
  const editor = useRef(null);
  const [copied, setCopied] = useState(null);
  useEffect(() => {
    if (copied === null) return undefined;
    const t = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    const ok = (await editor.current?.copyNote?.()) ?? false;
    setCopied(ok ? 'yes' : 'no');
  };
  const copyLabel = copied === 'yes' ? 'Copied' : copied === 'no' ? "Couldn't copy" : 'Copy';

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

        {/* With the sidebar put away, this is the way back to it. */}
        {!sidebarOpen && (
          <Button
            variant="ghost"
            size="icon"
            data-sidebar-open
            className="hidden size-8 shrink-0 md:inline-flex"
            aria-label="Show sidebar"
            title={`Show sidebar (${SIDEBAR_SHORTCUT})`}
            onClick={onShowSidebar}
          >
            <PanelLeftOpen />
          </Button>
        )}

        <Input
          value={note.title}
          placeholder={placeholder}
          aria-label="Note title"
          // A title taken from the first line is the note's name all the
          // same, so it is set in the same ink as a typed one. Grey made a
          // saved note look as if it had no name at all.
          className={cn(
            'h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-[15px] font-semibold shadow-none focus-visible:ring-0 md:text-[15px] dark:bg-transparent',
            derived && 'placeholder:text-foreground'
          )}
          onChange={(e) => onChange({ ...note, title: e.target.value, titleEdited: true })}
        />

        <span
          className="text-muted-foreground hidden shrink-0 text-xs lg:inline"
          title={note.updated_at ? fullTime(note.updated_at) : undefined}
        >
          {note.updated_at ? relativeTime(note.updated_at) : 'Not saved yet'}
        </span>

        <Button
          variant="ghost"
          size="sm"
          data-copy-note=""
          className="text-muted-foreground hover:text-foreground h-8 shrink-0 gap-1.5 px-2 text-xs pointer-coarse:h-11"
          title="Copy the whole note, with images as files"
          aria-label={copyLabel === 'Copy' ? 'Copy the whole note' : copyLabel}
          onClick={copy}
        >
          {copied === 'yes' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          <span className="hidden sm:inline">{copyLabel}</span>
        </Button>

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

      <MilkdownEditor
        note={note}
        onChange={onChange}
        onReady={(api) => {
          editor.current = api;
          onReady?.(api);
        }}
      />
    </div>
  );
}
