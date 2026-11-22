import { NotebookPen, PanelLeftOpen, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SIDEBAR_SHORTCUT } from '@/components/NoteList';

export default function EmptyState({ onNew, sidebarOpen = true, onShowSidebar }) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-4 text-center">
      {!sidebarOpen && (
        <Button
          variant="ghost"
          size="icon"
          data-sidebar-open
          className="absolute top-2.5 left-3 hidden size-8 md:inline-flex"
          aria-label="Show sidebar"
          title={`Show sidebar (${SIDEBAR_SHORTCUT})`}
          onClick={onShowSidebar}
        >
          <PanelLeftOpen />
        </Button>
      )}
      <div className="bg-muted rounded-full p-4">
        <NotebookPen className="text-muted-foreground size-7" />
      </div>
      <div>
        <p className="font-medium">No note open</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Pick one from the sidebar, or start writing something new.
        </p>
      </div>
      {/* Worded apart from the sidebar's "New note", so a screen reader is
          not offered two identical buttons with nothing to tell them apart. */}
      <Button onClick={onNew}>
        <Plus /> Start writing
      </Button>
    </div>
  );
}
