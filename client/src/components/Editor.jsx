import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Bold,
  Code,
  Heading,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Save,
  SquareCheck,
  SquareCode,
  Strikethrough,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DeleteNoteDialog } from '@/components/DeleteNoteDialog';
import { toast } from 'sonner';
import { actions } from '@/lib/editorActions';
import { uploadAttachment } from '@/lib/api';
import { renderMarkdown } from '@/lib/markdown';
import { scrollCaretIntoView } from '@/lib/sourceMap';
import { continuation, enterInList, plainBreak } from '@/lib/listContinuation';

const TOOLBAR = [
  [
    { key: 'heading', icon: Heading, label: 'Heading' },
    { key: 'bold', icon: Bold, label: 'Bold', hint: 'Ctrl+B' },
    { key: 'italic', icon: Italic, label: 'Italic', hint: 'Ctrl+I' },
    { key: 'strike', icon: Strikethrough, label: 'Strikethrough' },
  ],
  [
    { key: 'quote', icon: Quote, label: 'Blockquote' },
    { key: 'code', icon: Code, label: 'Inline code' },
    { key: 'codeBlock', icon: SquareCode, label: 'Code block' },
    { key: 'link', icon: Link2, label: 'Link', hint: 'Ctrl+K' },
  ],
  [
    { key: 'bullet', icon: List, label: 'Bulleted list' },
    { key: 'numbered', icon: ListOrdered, label: 'Numbered list' },
    { key: 'task', icon: ListTodo, label: 'Task list' },
    { key: 'toggleTask', icon: SquareCheck, label: 'Tick / untick', hint: 'Ctrl+Shift+X' },
    { key: 'hr', icon: Minus, label: 'Horizontal rule' },
  ],
];

export default function Editor({
  note, onChange, onSave, onCancel, onDelete, saving, dirty, caretAt, status,
}) {
  const [tab, setTab] = useState('write');
  const [dropping, setDropping] = useState(false);
  const textareaRef = useRef(null);

  // Where the cursor must go once React has committed the new value. The
  // textarea is controlled, so setting a selection before the commit is undone
  // by the re-render — and the next character typed lands at the end instead.
  const pendingSelection = useRef(null);

  useLayoutEffect(() => {
    const at = pendingSelection.current;
    const el = textareaRef.current;
    if (!at || !el) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(at.start, at.end);
  });

  const select = (start, end = start) => {
    pendingSelection.current = { start, end };
  };

  const apply = (key) => {
    const el = textareaRef.current;
    if (!el) return;
    const next = actions[key]({
      value: note.content,
      start: el.selectionStart,
      end: el.selectionEnd,
    });
    onChange({ ...note, content: next.value });
    select(next.start, next.end);
  };

  // Put text where the cursor is, or at the end if the textarea has never
  // been focused.
  const insert = (text) => {
    const el = textareaRef.current;
    const at = el ? el.selectionStart : note.content.length;
    const before = note.content.slice(0, at);
    const after = note.content.slice(at);
    // Keep the line to itself: an image wedged into a paragraph renders as
    // part of that paragraph.
    const lead = before === '' || before.endsWith('\n') ? '' : '\n';
    onChange({ ...note, content: `${before}${lead}${text}\n${after}` });
    select(before.length + lead.length + text.length + 1);
  };

  // Drops and pastes share this, so a saved file and a screenshot behave the
  // same way. Uploads run one at a time: each insert depends on where the
  // previous one left the cursor.
  const take = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    for (const file of list) {
      try {
        const { markdown } = await uploadAttachment(file);
        insert(markdown);
      } catch (err) {
        toast.error(`Could not attach ${file.name || 'that file'}`, {
          description: err.message,
        });
      }
    }
  };

  // Replace the whole value and put the cursor somewhere exact. Used by the
  // keys that edit text directly rather than through an action.
  const put = (value, caret) => {
    onChange({ ...note, content: value });
    select(caret);
  };

  const onKeyDown = (e) => {
    const el = textareaRef.current;
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }

    // Enter carries a list on; Shift+Enter breaks the line and leaves it
    // alone. A terminal sends the same byte for both, which is why the TUI
    // spends alt+enter on this and the browser does not have to.
    if (e.key === 'Enter' && !mod && el) {
      e.preventDefault();
      const { value, caret } = e.shiftKey
        ? plainBreak(note.content, el.selectionStart, el.selectionEnd)
        : enterInList(note.content, el.selectionStart, el.selectionEnd);
      put(value, caret);
      return;
    }

    // Tab indents the line rather than leaving the textarea. The terminal
    // cannot bind this at all, since ctrl+i *is* Tab.
    if (e.key === 'Tab' && !mod && el) {
      e.preventDefault();
      const { selectionStart: from, selectionEnd: to } = el;
      const out = actions[e.shiftKey ? 'outdent' : 'indent']({
        value: note.content, start: from, end: to,
      });
      onChange({ ...note, content: out.value });
      if (from !== to) {
        // A selection stays selected, so Tab can be pressed again.
        select(out.start, out.end);
      } else {
        // A plain cursor keeps its place in the line rather than selecting it,
        // which would make the next character typed replace the whole line.
        const shift = out.value.length - note.content.length;
        select(Math.max(out.start, from + shift));
      }
      return;
    }

    // Backspace at the start of an empty item clears the marker instead of
    // eating the line break above it.
    if (e.key === 'Backspace' && !mod && el && el.selectionStart === el.selectionEnd) {
      const at = el.selectionStart;
      const lineStart = note.content.lastIndexOf('\n', at - 1) + 1;
      const line = note.content.slice(lineStart, at);
      if (line !== '' && continuation(line).endList) {
        e.preventDefault();
        put(note.content.slice(0, lineStart) + note.content.slice(at), lineStart);
        return;
      }
    }

    if (!mod) return;
    const key = e.key.toLowerCase();
    // Ctrl+S is deliberately not handled here. It is caught on the window in
    // App, so that it also works while reading — where there is no textarea to
    // receive it, and the browser would otherwise open Save Page As.
    if (key === 's' && !e.shiftKey) return;
    // Ctrl+Shift+… for the actions a terminal has to reach with alt+, because
    // alt+letter opens the menu bar in some browsers.
    const shortcut = e.shiftKey
      ? { s: 'strike', c: 'code', f: 'codeBlock', q: 'quote', l: 'bullet',
          o: 'numbered', t: 'task', x: 'toggleTask', r: 'hr', h: 'heading' }[key]
      : { b: 'bold', i: 'italic', k: 'link' }[key];
    if (shortcut) {
      e.preventDefault();
      apply(shortcut);
    }
  };

  // Always land on Write when a different note opens.
  useEffect(() => setTab('write'), [note.id]);

  // Land the cursor where the reader clicked, once per click. caretAt is a
  // fresh object each time so that clicking the same block twice still moves
  // the cursor back to it.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !caretAt) return;
    el.focus();
    // A click that landed on padding rather than on a block says where to
    // start writing but not where: focus, and leave the cursor alone rather
    // than throwing it to the top of the note.
    if (caretAt.offset === null) return;
    const at = Math.min(caretAt.offset, el.value.length);
    el.setSelectionRange(at, at);
    scrollCaretIntoView(el, at);
  }, [caretAt]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={note.title}
          placeholder="Note title…"
          className="h-10 flex-1 border-0 bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:ring-0 md:text-lg"
          onChange={(e) => onChange({ ...note, title: e.target.value })}
        />
        <div className="flex items-center gap-2">
          {/* Saving is no longer something you have to remember to do, so the
              badge reports it rather than nagging about it. */}
          <Badge variant="secondary" className="text-muted-foreground">
            {{ editing: 'Editing', saving: 'Saving…', saved: 'Saved' }[status]}
          </Badge>
          <Button onClick={onSave} disabled={saving || !dirty}>
            <Save /> {saving ? 'Saving…' : note.id ? 'Save' : 'Create'}
          </Button>
          {note.id && (
            <DeleteNoteDialog title={note.title} onConfirm={() => onDelete(note.id)}>
              <Button variant="outline" size="icon" aria-label="Delete note">
                <Trash2 className="text-destructive" />
              </Button>
            </DeleteNoteDialog>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="write">Write</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="write" className="flex min-h-0 flex-col gap-2">
          <div className="bg-muted/50 flex flex-wrap items-center gap-0.5 rounded-lg border p-1">
            {TOOLBAR.map((group, i) => (
              <div key={i} className="flex items-center gap-0.5">
                {i > 0 && <Separator orientation="vertical" className="mx-1.5 !h-5" />}
                {group.map(({ key, icon: Icon, label, hint }) => (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={label}
                        onClick={() => apply(key)}
                      >
                        <Icon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {label}
                      {hint && <span className="opacity-60"> · {hint}</span>}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>

          <div
            className="relative flex min-h-0 flex-1 flex-col"
            onDragOver={(e) => {
              // Without this the browser navigates away to the dropped file.
              e.preventDefault();
              setDropping(true);
            }}
            onDragLeave={(e) => {
              // Ignore the events fired while crossing child elements.
              if (e.currentTarget.contains(e.relatedTarget)) return;
              setDropping(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDropping(false);
              take(e.dataTransfer.files);
            }}
          >
            <Textarea
              ref={textareaRef}
              value={note.content}
              placeholder="Write your note in Markdown…"
              onChange={(e) => onChange({ ...note, content: e.target.value })}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                // Only step in for a paste that carries files; pasting text
                // must behave exactly as it always has.
                if (!e.clipboardData.files.length) return;
                e.preventDefault();
                take(e.clipboardData.files);
              }}
              spellCheck
              className="min-h-0 flex-1 resize-none font-mono text-[13px] leading-relaxed"
            />
            {dropping && (
              <div className="bg-background/80 text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed text-sm font-medium">
                Drop to attach
              </div>
            )}
          </div>

          <p className="text-muted-foreground text-xs">
            <kbd className="font-mono">↵</kbd> carries a list on ·{' '}
            <kbd className="font-mono">Shift+↵</kbd> plain line break ·{' '}
            <kbd className="font-mono">Tab</kbd> indents ·{' '}
            <kbd className="font-mono">Ctrl+S</kbd> saves ·{' '}
            <kbd className="font-mono">Esc</kbd> cancels · drop or paste a file to
            attach it
          </p>
        </TabsContent>

        <TabsContent
          value="preview"
          className="min-h-0 overflow-y-auto rounded-lg border p-5"
        >
          {note.content.trim() ? (
            <article
              className="prose prose-zinc dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}
            />
          ) : (
            <p className="text-muted-foreground text-sm">Nothing to preview yet.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
