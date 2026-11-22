import { Crepe } from '@milkdown/crepe';
import { toast } from 'sonner';
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { imageBlockSchema } from '@milkdown/kit/component/image-block';
import { remarkGFMPlugin } from '@milkdown/kit/preset/gfm';
import { attachment } from './attachmentNode';
import { imageResize } from './imageResize';
import { imageChips } from './imageChips';
import { emptyTaskPlugin } from './emptyTask';
import { blockMenu } from './blockMenu';
import { buildTopBar } from './topBar';
import { editorChrome } from './editorChrome';
import { taskCheckedIcon, taskUncheckedIcon } from './taskIcons';
import { languageLabel, languages } from './languages';
import { taskToggle } from './taskToggle';
import { copyPaths } from './copyPaths';

// Two things in Milkdown 7.22.2 damage a note on the way through.
//
// First, image attributes are declared validate:"string" but the parser hands
// through whatever mdast produced, which is null when the markdown omits it -
// and `![alt](src)` omits the title. ProseMirror rejects the null and drops
// the whole node, so the image vanishes and attach.Refs stops seeing the file,
// which is what gets it trashed on the next sweep.
//
// Second, and worse because it looks like it worked: the image-block
// component uses markdown's alt slot to carry its own resize ratio. It parses
// `Number(node.alt || 1)` and writes back `alt: ratio.toFixed(2)`, so
// `![diagram](attachments/x.png)` returns as `![1.00](attachments/x.png)`.
// The reference survives; the name a person gave the file does not. Every
// attachment nib writes puts its filename in that slot.
//
// nib keeps media sizes in local storage (see lib/mediaSize.js), so the ratio
// has no business in the note at all. Alt means alt here, and the ratio stays
// at its default.
const relaxAttrs = (attrs = {}) => {
  const out = {};
  for (const [key, spec] of Object.entries(attrs)) {
    const { validate, ...rest } = spec;
    out[key] = { ...rest, default: rest.default ?? '' };
  }
  return out;
};

const imageFix = imageSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return { ...base, attrs: relaxAttrs(base.attrs) };
});

const imageBlockFix = imageBlockSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    attrs: { ...relaxAttrs(base.attrs), alt: { default: '' }, ratio: { default: 1 } },
    parseMarkdown: {
      ...base.parseMarkdown,
      runner: (state, node, type) => {
        state.addNode(type, {
          src: node.url ?? '',
          alt: node.alt ?? '',
          caption: node.title ?? '',
          ratio: 1,
        });
      },
    },
    toMarkdown: {
      ...base.toMarkdown,
      runner: (state, node) => {
        state.openNode('paragraph');
        state.addNode('image', undefined, undefined, {
          url: node.attrs.src,
          alt: node.attrs.alt ?? '',
          // null, not "", or remark writes an empty title: ![a](b "").
          title: node.attrs.caption || null,
        });
        state.closeNode();
      },
    },
  };
});

export const imageFixes = [imageFix, imageBlockFix];

// remark-stringify's defaults rewrite markdown the terminal wrote: - bullets
// become *, --- becomes ***. Left alone, opening a note in the browser would
// silently rewrite a file the typist never touched. These keep both halves of
// nib writing the same thing.
export const stringifyOptions = {
  bullet: '-',
  rule: '-',
  emphasis: '*',
  strong: '*',
  fences: true,
  resourceLink: false,
  tightDefinitions: true,
};

// createEditor builds the editor nib ships, without creating it: the caller
// decides when, because mounting is asynchronous and React wants to own it.
export function createEditor(root, { markdown = '', features = {}, onUpload } = {}) {
  const crepe = new Crepe({
    root,
    defaultValue: markdown,
    features: {
      [Crepe.Feature.Latex]: false, // katex is aliased away at build time
      [Crepe.Feature.AI]: false,
      // Both toolbars, not one: the bubble over a selection is for changing
      // text you have already written, and the bar at the top is for choosing
      // what you are about to write. Needing to know the slash menu exists
      // before you can start a heading is not a design, it is a gap.
      // Crepe ships this one off by default, so it has to be asked for.
      [Crepe.Feature.TopBar]: true,
      ...features,
    },
    featureConfigs: {
      ...(onUpload ? { [Crepe.Feature.ImageBlock]: { onUpload } } : {}),
      // Headings on the bar itself, not only behind the dropdown.
      [Crepe.Feature.TopBar]: { buildTopBar },
      // Round to-dos: a ring to do, a filled blue circle when done.
      [Crepe.Feature.ListItem]: {
        checkBoxCheckedIcon: taskCheckedIcon,
        checkBoxUncheckedIcon: taskUncheckedIcon,
      },
      // Copying a link from its preview gave no sign that anything happened.
      [Crepe.Feature.LinkTooltip]: {
        onCopyLink: () => toast.success('Link copied'),
      },
      // The stub behind @codemirror/language-data is empty, so without a
      // list of its own the language picker opened onto "No result".
      [Crepe.Feature.CodeMirror]: {
        languages,
        renderLanguage: (name) => languageLabel(name),
        searchPlaceholder: 'Find a language',
        noResultText: 'No language by that name',
      },
      // Crepe's own is "Please enter...", which reads like a form field.
      [Crepe.Feature.Placeholder]: { text: 'Start writing, or type / for blocks' },
    },
  });
  crepe.editor
    .config((ctx) => {
      ctx.set(remarkStringifyOptionsCtx, stringifyOptions);
      // Tables get normalised whichever way this goes: left alone, remark
      // pads every cell to its column; turned off, the delimiter row collapses
      // to `| - |`. Padding wins because the terminal shows raw markdown while
      // editing, and an aligned table is easier to read there. It happens once
      // and then holds - see the idempotency test.
      ctx.set(remarkGFMPlugin.options.key, { tablePipeAlign: true });
      copyPaths(ctx);
    })
    .use(imageFixes)
    .use(attachment)
    .use(imageResize)
    .use(imageChips)
    .use(emptyTaskPlugin)
    .use(blockMenu)
    .use(taskToggle)
    .use(editorChrome);
  return crepe;
}

// roundTrip is what the guard tests measure: markdown in, markdown out, with
// nothing in between but the editor nib actually ships.
export async function roundTrip(markdown) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const crepe = createEditor(root, { markdown });
  await crepe.create();
  const out = crepe.getMarkdown();
  await crepe.destroy();
  root.remove();
  return out;
}

// roundTripWithAttachments is the same measurement as roundTrip, kept separate
// only so the attachment tests name what they are exercising.
export const roundTripWithAttachments = roundTrip;
