import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import {
  headingSchema,
  paragraphSchema,
  setBlockTypeCommand,
} from '@milkdown/kit/preset/commonmark';

// Crepe's top bar offers headings through a dropdown at its left end, labelled
// with whatever the cursor is currently in. It works, but it reads as a label
// rather than a control: standing in a paragraph it says "Paragraph", so
// someone looking along the bar for a way to make a heading finds no heading
// anywhere on it. The dropdown stays, for H4 to H6 and for going back to plain
// text; these three put the ones people actually reach for on the bar itself.
export const HEADING_BUTTONS = [1, 2, 3];

// Material's 24px grid, to sit level with the icons Crepe ships. Drawn rather
// than imported: Crepe keeps its icons off its public export paths.
const HEADING_ICONS = {
  1: `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M3 5h2v5h5V5h2v12h-2v-5H5v5H3V5zm14 3.5V17h2V6h-1.5l-2.5 1.75 1 1.5L17 8.5z"/></svg>`,
  2: `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M3 5h2v5h5V5h2v12h-2v-5H5v5H3V5zm11 12v-1.7c0-.6.2-1.1.6-1.5l2.6-2.6c.4-.4.6-.8.6-1.2 0-.7-.5-1.1-1.2-1.1-.7 0-1.2.4-1.3 1.2H14c.1-1.9 1.4-3 3.2-3 1.9 0 3.1 1.1 3.1 2.8 0 .9-.4 1.7-1.2 2.4l-2 1.9h3.3V17H14z"/></svg>`,
  3: `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M3 5h2v5h5V5h2v12h-2v-5H5v5H3V5zm14.2 12c-1.9 0-3.3-1.1-3.4-2.9h1.9c.1.7.6 1.2 1.5 1.2.8 0 1.4-.4 1.4-1.2 0-.7-.5-1.1-1.4-1.1h-.9v-1.6h.9c.8 0 1.2-.4 1.2-1s-.5-1-1.2-1c-.8 0-1.2.4-1.3 1.1h-1.9c.1-1.7 1.4-2.8 3.2-2.8 1.9 0 3.1 1 3.1 2.5 0 .9-.5 1.6-1.3 1.9.9.3 1.5 1 1.5 2.1 0 1.6-1.4 2.8-3.3 2.8z"/></svg>`,
};

// Whether the cursor is already inside a heading of this level, so the button
// can light up the way the bold and italic ones do.
export function isHeadingActive(ctx, level) {
  const view = ctx.get(editorViewCtx);
  const node = view.state.selection.$from.parent;
  return node.type === headingSchema.type(ctx) && node.attrs.level === level;
}

// Pressing the button you are already in goes back to plain text, which is
// what every other toggle on the bar does and what makes the pair of them one
// control rather than a one-way trip.
export function toggleHeading(ctx, level) {
  const commands = ctx.get(commandsCtx);
  if (isHeadingActive(ctx, level)) {
    commands.call(setBlockTypeCommand.key, { nodeType: paragraphSchema.type(ctx) });
    return;
  }
  commands.call(setBlockTypeCommand.key, {
    nodeType: headingSchema.type(ctx),
    attrs: { level },
  });
}

// What each button on the bar is called. Crepe draws them as bare icons with
// no name at all, so a screen reader announced seventeen of them as "button"
// and a mouse got no tooltip to say what the terminal-box one was for.
export const TOP_BAR_LABELS = {
  nibH1: 'Heading 1',
  nibH2: 'Heading 2',
  nibH3: 'Heading 3',
  bold: 'Bold',
  italic: 'Italic',
  strikethrough: 'Strikethrough',
  code: 'Inline code',
  'bullet-list': 'Bulleted list',
  'ordered-list': 'Numbered list',
  'task-list': 'Task list',
  link: 'Link',
  image: 'Image',
  table: 'Table',
  'code-block': 'Code block',
  math: 'Math',
  quote: 'Quote',
  hr: 'Divider',
};

// The keys of the buttons the bar ended up with, in the order they are drawn.
// Crepe renders straight from the groups, so this is the order of the DOM.
let drawnKeys = [];
export const topBarKeys = () => drawnKeys;

// buildTopBar is handed to Crepe, after its own groups are in place.
//
// The headings go first. Crepe's own way in was a "Paragraph" dropdown that
// read as a label rather than a control, and once these three buttons were on
// the bar it only repeated them - two controls side by side doing one job,
// costing a sixth of the bar's width. The dropdown is gone; pressing a
// heading's button again returns to plain text, and H4 to H6 are still a
// `####` away.
export function buildTopBar(builder) {
  const group = builder.addGroup('nibHeadings', 'Headings');
  for (const level of HEADING_BUTTONS) {
    group.addItem(`nibH${level}`, {
      icon: HEADING_ICONS[level],
      active: (ctx) => isHeadingActive(ctx, level),
      onRun: (ctx) => toggleHeading(ctx, level),
    });
  }
  // build() hands back the builder's own list, so arranging it here is
  // arranging the bar. A builder without one (the tests' stand-in) is left as
  // it was given.
  const groups = builder.build?.();
  if (!groups) return;
  const at = (key) => groups.findIndex((g) => g.key === key);
  if (at('heading') !== -1) groups.splice(at('heading'), 1);
  groups.unshift(...groups.splice(at('nibHeadings'), 1));
  drawnKeys = groups.flatMap((g) => g.items.filter((i) => i.onRun).map((i) => i.key));
}

// Names every button on the bar, by position. The bar is a Vue app that
// re-renders as the selection moves, so this runs whenever it changes.
export function labelTopBar(bar, keys = topBarKeys()) {
  const buttons = bar.querySelectorAll('.top-bar-item');
  buttons.forEach((button, i) => {
    const label = TOP_BAR_LABELS[keys[i]];
    if (!label) return;
    if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
    if (button.title !== label) button.title = label;
    const pressed = String(button.classList.contains('active'));
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
  });
  // The bar is a toolbar, which is what tells assistive technology that the
  // buttons in it belong together.
  if (bar.getAttribute('role') !== 'toolbar') {
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Formatting');
  }
}
