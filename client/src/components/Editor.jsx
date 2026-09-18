import { useEffect, useRef, useState } from 'react';
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
    { key: 'hr', icon: Minus, label: 'Horizontal rule' },
  ],
];

export default function Editor({
  note, onChange, onSave, onCancel, onDelete, saving, dirty, caretAt, status,
}) {
  const [tab, setTab] = useState('write');
  const [dropping, setDropping] = useState(false);
  const textareaRef = useRef(null);

  const apply = (key) => {
    const el = textareaRef.current;
    if (!el) return;
    const next = actions[key]({
      value: note.content,
      start: el.selectionStart,
      end: el.selectionEnd,
    });
    onChange({ ...note, content: next.value });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
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
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = before.length + lead.length + text.length + 1;
      el.setSelectionRange(caret, caret);
    });
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

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      onSave();
      return;
    }
    const shortcut = { b: 'bold', i: 'italic', k: 'link' }[key];
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
            Markdown supported · <kbd className="font-mono">Ctrl+S</kbd> to save ·{' '}
            <kbd className="font-mono">Esc</kbd> to cancel · drop or paste a file to
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
