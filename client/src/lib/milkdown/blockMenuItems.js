import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import {
  addBlockTypeCommand,
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  headingSchema,
  hrSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  selectTextNearPosCommand,
  setBlockTypeCommand,
  wrapInBlockTypeCommand,
} from '@milkdown/kit/preset/commonmark';
import { createTable } from '@milkdown/kit/preset/gfm';
import { imageBlockSchema } from '@milkdown/kit/component/image-block';
import { blockRangeAt, deleteBlock, duplicateBlock } from './blockOps';

// What the six dots offer. This is deliberately not Crepe's own slash menu,
// though it carries the same things, because that menu exists to turn what you
// have just typed into a block: every one of its items calls
// clearTextInCurrentBlockCommand first, to wipe the `/table` you typed to summon
// it. Run against a paragraph that already holds a sentence, it would delete the
// sentence. It also refuses to open inside a list or a code block, and filters
// itself by whatever text the block already contains - which for any real
// paragraph matches nothing at all.
//
// So: the same items, the same icons, commands that convert rather than clear.

// Material's 24px grid, matching the icons Crepe draws elsewhere on the bar.
// Drawn here because Crepe keeps its icon module off its public export paths.
const icon = (path, box = '0 -960 960 960') =>
  `<svg xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="${box}" fill="currentColor"><path d="${path}"/></svg>`;

const ICONS = {
  duplicate: icon('M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z'),
  delete: icon('M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z'),
  text: icon('M420-160v-520H200v-120h560v120H540v520H420Z'),
  h1: icon('M200-280v-400h80v160h160v-160h80v400h-80v-160H280v160h-80Zm480 0v-320h-80v-80h160v400h-80Z'),
  h2: icon('M120-280v-400h80v160h160v-160h80v400h-80v-160H200v160h-80Zm400 0v-160q0-33 23.5-56.5T600-520h160v-80H520v-80h240q33 0 56.5 23.5T840-600v80q0 33-23.5 56.5T760-440H600v80h240v80H520Z'),
  h3: icon('M120-280v-400h80v160h160v-160h80v400h-80v-160H200v160h-80Zm400 0v-80h240v-80H600v-80h160v-80H520v-80h240q33 0 56.5 23.5T840-600v240q0 33-23.5 56.5T760-280H520Z'),
  quote: icon('M580-360q-25 0-42.5-17.5T520-420v-160q0-25 17.5-42.5T580-640h120q25 0 42.5 17.5T760-580v220q0 66-47 113t-113 47v-80q33 0 56.5-23.5T680-360H580Zm-360 0q-25 0-42.5-17.5T160-420v-160q0-25 17.5-42.5T220-640h120q25 0 42.5 17.5T400-580v220q0 66-47 113t-113 47v-80q33 0 56.5-23.5T320-360H220Z'),
  bulletList: icon('M360-200v-80h480v80H360Zm0-240v-80h480v80H360Zm0-240v-80h480v80H360ZM200-160q-33 0-56.5-23.5T120-240q0-33 23.5-56.5T200-320q33 0 56.5 23.5T280-240q0 33-23.5 56.5T200-160Zm0-240q-33 0-56.5-23.5T120-480q0-33 23.5-56.5T200-560q33 0 56.5 23.5T280-480q0 33-23.5 56.5T200-400Zm0-240q-33 0-56.5-23.5T120-720q0-33 23.5-56.5T200-800q33 0 56.5 23.5T280-720q0 33-23.5 56.5T200-640Z'),
  orderedList: icon('M120-80v-60h100v-30h-60v-60h60v-30H120v-60h120q17 0 28.5 11.5T280-280v40q0 17-11.5 28.5T240-200q17 0 28.5 11.5T280-160v40q0 17-11.5 28.5T240-80H120Zm0-280v-110q0-17 11.5-28.5T160-510h60v-30H120v-60h120q17 0 28.5 11.5T280-560v70q0 17-11.5 28.5T240-450h-60v30h100v40H120Zm60-280v-180h-60v-60h120v240h-60Zm180 440v-80h480v80H360Zm0-240v-80h480v80H360Zm0-240v-80h480v80H360Z'),
  taskList: icon('m380-300 280-280-56-56-224 224-84-84-56 56 140 140Zm-180 220q-33 0-56.5-23.5T120-160v-640q0-33 23.5-56.5T200-880h640q33 0 56.5 23.5T920-800v640q0 33-23.5 56.5T840-80H200Zm0-80h640v-640H200v640Zm0-640v640-640Z'),
  code: icon('M320-240 80-480l240-240 57 57-184 184 183 183-56 56Zm320 0-57-57 184-184-183-183 56-56 240 240-240 240Z'),
  divider: icon('M160-440v-80h640v80H160Z'),
  image: icon('M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h480L570-480 450-320l-90-120-120 160Zm-40 80v-560 560Z'),
  table: icon('M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h180v-140H200v140Zm260 0h300v-140H460v140ZM200-420h180v-140H200v140Zm260 0h300v-140H460v140ZM200-640h560v-120H200v120Z'),
};

// Converting keeps what is in the block. Crepe's own items clear it first; that
// is the single most important difference in this file.
const setBlock = (nodeType, attrs) => (ctx) => {
  ctx.get(commandsCtx).call(setBlockTypeCommand.key, { nodeType: nodeType(ctx), ...(attrs ? { attrs } : {}) });
};

const wrapBlock = (nodeType, attrs) => (ctx) => {
  ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, { nodeType: nodeType(ctx), ...(attrs ? { attrs } : {}) });
};

const addBlock = (nodeType) => (ctx) => {
  ctx.get(commandsCtx).call(addBlockTypeCommand.key, { nodeType: nodeType(ctx) });
};

const insertTable = (ctx) => {
  const commands = ctx.get(commandsCtx);
  const view = ctx.get(editorViewCtx);
  // Where the cursor was, so it can be put back inside the new table rather
  // than left wherever the insert happened to leave it.
  const { from } = view.state.selection;
  commands.call(addBlockTypeCommand.key, { nodeType: createTable(ctx, 3, 3) });
  commands.call(selectTextNearPosCommand.key, { pos: from });
};

const onBlock = (edit) => (ctx) => {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  edit(state, view.dispatch.bind(view), blockRangeAt(state.doc, state.selection.from));
  view.focus();
};

// The groups, in the order they are shown. "Block" first: the dots are how you
// reach a block that is already there, so the two things that act on one should
// not sit below three groups of things that make another.
export const MENU_GROUPS = [
  {
    key: 'block',
    label: 'Block',
    items: [
      { key: 'duplicate', label: 'Duplicate', icon: ICONS.duplicate, run: onBlock(duplicateBlock) },
      { key: 'delete', label: 'Delete', icon: ICONS.delete, danger: true, run: onBlock(deleteBlock) },
    ],
  },
  {
    key: 'turnInto',
    label: 'Turn into',
    items: [
      { key: 'text', label: 'Text', icon: ICONS.text, run: setBlock((c) => paragraphSchema.type(c)) },
      { key: 'h1', label: 'Heading 1', icon: ICONS.h1, run: setBlock((c) => headingSchema.type(c), { level: 1 }) },
      { key: 'h2', label: 'Heading 2', icon: ICONS.h2, run: setBlock((c) => headingSchema.type(c), { level: 2 }) },
      { key: 'h3', label: 'Heading 3', icon: ICONS.h3, run: setBlock((c) => headingSchema.type(c), { level: 3 }) },
      { key: 'quote', label: 'Quote', icon: ICONS.quote, run: wrapBlock((c) => blockquoteSchema.type(c)) },
      { key: 'bulletList', label: 'Bullet list', icon: ICONS.bulletList, run: wrapBlock((c) => bulletListSchema.type(c)) },
      { key: 'orderedList', label: 'Ordered list', icon: ICONS.orderedList, run: wrapBlock((c) => orderedListSchema.type(c)) },
      { key: 'taskList', label: 'Task list', icon: ICONS.taskList, run: wrapBlock((c) => listItemSchema.type(c), { checked: false }) },
      { key: 'code', label: 'Code', icon: ICONS.code, run: setBlock((c) => codeBlockSchema.type(c)) },
    ],
  },
  {
    key: 'insert',
    label: 'Insert below',
    items: [
      { key: 'divider', label: 'Divider', icon: ICONS.divider, run: addBlock((c) => hrSchema.type(c)) },
      { key: 'image', label: 'Image', icon: ICONS.image, run: addBlock((c) => imageBlockSchema.type(c)) },
      { key: 'table', label: 'Table', icon: ICONS.table, run: insertTable },
    ],
  },
];

export const ALL_ITEMS = MENU_GROUPS.flatMap((g) => g.items);
