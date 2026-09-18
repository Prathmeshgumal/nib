import Editor from '@/components/Editor';
import ReadView from '@/components/ReadView';

// The two faces of one open note. Which one shows is a mode, not a different
// note, which is what lets a click move between them.
export default function NotePane({
  note, mode, onOpenAt, onToggleTask, onChange, onSave, onCancel, onDelete, saving,
  dirty, caretAt, status,
}) {
  if (mode === 'write') {
    return (
      <Editor
        note={note}
        onChange={onChange}
        onSave={onSave}
        onCancel={onCancel}
        onDelete={onDelete}
        saving={saving}
        dirty={dirty}
        caretAt={caretAt}
        status={status}
      />
    );
  }
  return (
    <ReadView
      note={note}
      onDelete={onDelete}
      onOpenAt={onOpenAt}
      onToggleTask={onToggleTask}
    />
  );
}
