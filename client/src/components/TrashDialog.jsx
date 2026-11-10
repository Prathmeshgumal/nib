import { useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { relativeTime } from '@/lib/time';

export function TrashDialog({ open, onOpenChange, trash, onRestore, onPurge, onEmpty }) {
  const [selected, setSelected] = useState(null);

  // A note that has just been restored or purged is no longer in the list.
  useEffect(() => {
    if (selected && !trash.some((n) => n.id === selected.id)) setSelected(null);
  }, [trash, selected]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Trash</DialogTitle>
          <DialogDescription>
            Deleted notes are kept for 30 days, then removed automatically.
          </DialogDescription>
        </DialogHeader>

        {trash.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            The trash is empty.
          </p>
        ) : (
          <ScrollArea className="-mx-2 max-h-[45vh] min-h-0 flex-1 px-2">
            <ul className="space-y-1">
              {trash.map((note) => (
                <li
                  key={note.id}
                  className="hover:bg-accent flex items-center gap-3 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{note.title || 'Untitled'}</div>
                    <div className="text-muted-foreground text-xs">
                      Last edited {relativeTime(note.updated_at)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRestore(note)}
                    aria-label={`Restore ${note.title}`}
                  >
                    <RotateCcw /> Restore
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setSelected(note)}
                    aria-label={`Delete ${note.title} for good`}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}

        {trash.length > 0 && (
          <>
            <Separator />
            <DialogFooter className="flex-row items-center justify-between sm:justify-between">
              <Badge variant="secondary" className="text-muted-foreground">
                {trash.length} {trash.length === 1 ? 'note' : 'notes'}
              </Badge>
              <ConfirmDialog
                title="Empty the trash?"
                description={
                  trash.length === 1
                    ? 'The note in the trash will be permanently deleted. This cannot be undone.'
                    : `All ${trash.length} notes in the trash will be permanently deleted. This cannot be undone.`
                }
                confirmLabel="Empty trash"
                onConfirm={onEmpty}
              >
                <Button variant="outline">
                  <Trash2 className="text-destructive" /> Empty trash
                </Button>
              </ConfirmDialog>
            </DialogFooter>
          </>
        )}

        <ConfirmDialog
          open={selected !== null}
          onOpenChange={(v) => !v && setSelected(null)}
          title="Delete this note for good?"
          description={`“${selected?.title ?? ''}” will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete for good"
          onConfirm={() => {
            onPurge(selected);
            setSelected(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
