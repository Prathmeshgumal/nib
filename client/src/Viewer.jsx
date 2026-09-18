import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { ArrowLeft, Download, FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { kindOf, rawHref } from '@/lib/attachments';
import { delimiterFor, parse as parseCSV } from '@/lib/csv';
import { renderMarkdown } from '@/lib/markdown';

// Viewer shows one attachment on its own page, for the types a browser will
// not show by itself. It is a whole page rather than a panel inside the note
// because that is what a link in a new tab lands on.

// load fetches the file and turns it into something renderable. It is split
// out of the component so every kind's failure lands in one place.
async function load(name, kind) {
  if (kind === 'docx') {
    // mammoth is large and only ever needed for Word documents, so it is
    // pulled in here rather than bundled into the app everyone loads.
    const [{ default: mammoth }, res] = await Promise.all([
      import('mammoth/mammoth.browser'),
      fetch(rawHref(name)),
    ]);
    if (!res.ok) throw new Error(`The file could not be read (${res.status})`);
    const { value } = await mammoth.convertToHtml({
      arrayBuffer: await res.arrayBuffer(),
    });
    // mammoth's output is derived from the document's own contents, which is
    // exactly the untrusted input DOMPurify exists for.
    return { html: DOMPurify.sanitize(value) };
  }

  const res = await fetch(rawHref(name));
  if (!res.ok) throw new Error(`The file could not be read (${res.status})`);
  const text = await res.text();

  if (kind === 'csv') return { rows: parseCSV(text, delimiterFor(name)) };
  if (kind === 'markdown') return { html: renderMarkdown(text) };
  return { text };
}

function Table({ rows }) {
  if (!rows.length) return <Empty>That file has no rows in it.</Empty>;
  const [head, ...body] = rows;
  // A ragged file is normal - a short row means trailing empty cells, not a
  // broken table - so every row is padded to the widest one.
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const pad = (r) => Array.from({ length: width }, (_, i) => r[i] ?? '');

  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/50 sticky top-0">
          <tr>
            {pad(head).map((cell, i) => (
              <th key={i} className="border-b px-3 py-2 text-left font-medium whitespace-nowrap">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="even:bg-muted/20">
              {pad(row).map((cell, c) => (
                <td key={c} className="border-b px-3 py-1.5 align-top tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ children }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-3 py-16 text-center">
      <FileQuestion className="size-8" />
      <p className="max-w-sm text-sm">{children}</p>
    </div>
  );
}

export default function Viewer({ name, label }) {
  const kind = kindOf(name);
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    document.title = `${label} · Notes`;
  }, [label]);

  useEffect(() => {
    // Nothing to fetch: a container no browser decodes is a message, not a
    // download we should start on the reader's behalf.
    if (kind === 'film' || kind === 'file') {
      setState({ status: 'ready', data: {} });
      return;
    }
    let live = true;
    setState({ status: 'loading' });
    load(name, kind)
      .then((data) => live && setState({ status: 'ready', data }))
      .catch((e) => live && setState({ status: 'failed', error: e.message }));
    return () => {
      live = false;
    };
  }, [name, kind]);

  return (
    <div className="mx-auto flex h-svh max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Back to notes" asChild>
            <a href="/">
              <ArrowLeft />
            </a>
          </Button>
          <h1 className="truncate text-lg font-semibold tracking-tight">{label}</h1>
        </div>
        {/* The link no longer downloads, so the viewer has to offer it. */}
        <Button variant="outline" asChild>
          <a href={rawHref(name)} download={label}>
            <Download /> Download
          </a>
        </Button>
      </div>

      <Card className="min-h-0 flex-1 overflow-auto p-6">
        {state.status === 'loading' && (
          <p className="text-muted-foreground text-sm">Opening {label}…</p>
        )}

        {state.status === 'failed' && (
          <Empty>{state.error}</Empty>
        )}

        {state.status === 'ready' && kind === 'film' && (
          <Empty>
            No browser can play a {name.split('.').pop().toUpperCase()} file. Download it
            and open it in a video player.
          </Empty>
        )}

        {state.status === 'ready' && kind === 'file' && (
          <Empty>There is nothing to show for this kind of file. Download it to open it.</Empty>
        )}

        {state.status === 'ready' && state.data.rows && <Table rows={state.data.rows} />}

        {state.status === 'ready' && state.data.html !== undefined && (
          <article
            className="prose prose-zinc dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: state.data.html }}
          />
        )}

        {state.status === 'ready' && state.data.text !== undefined && (
          <pre className="text-sm leading-relaxed whitespace-pre-wrap">{state.data.text}</pre>
        )}
      </Card>
    </div>
  );
}
