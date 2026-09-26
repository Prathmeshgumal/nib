import { $remark } from '@milkdown/kit/utils';

// GFM says a task list item is a checkbox followed by content, so an item that
// is only a checkbox - `- [ ]`, an empty line on a to-do list - is not a task
// at all. remark parses it as literal text and writes it back escaped:
//
//     - [ ]      becomes      - \[ ]
//
// which is no longer a checkbox anywhere, in the browser or the terminal. An
// empty to-do is a perfectly ordinary thing to write, and losing it silently
// on the first open is the kind of damage nothing later would explain.
//
// This runs over the parsed tree and turns those items back into real tasks
// with nothing in them, which is what the typist meant and what the serializer
// then writes out unchanged.
const EMPTY_MARKER = /^\[([ xX])\][ \t]*$/;

function repairEmptyTasks(node) {
  if (!node || typeof node !== 'object') return;
  const children = node.children;
  if (!Array.isArray(children)) return;

  if (node.type === 'listItem' && node.checked === null) {
    const paragraph = children[0];
    const first = paragraph?.type === 'paragraph' ? paragraph.children?.[0] : null;
    if (first?.type === 'text') {
      const marker = EMPTY_MARKER.exec(first.value);
      if (marker && paragraph.children.length === 1) {
        node.checked = marker[1] !== ' ';
        // The paragraph stays so the item still has somewhere to put the
        // cursor, but the text goes entirely: ProseMirror refuses an empty
        // text node outright, so blanking the value is not the same thing.
        paragraph.children = [];
      }
    }
  }

  for (const child of children) repairEmptyTasks(child);
}

export const emptyTaskPlugin = $remark('nibEmptyTask', () => () => repairEmptyTasks);
