import { $nodeSchema } from '@milkdown/kit/utils';
import { kindOf, storedName } from '@/lib/attachments';

export const ATTACHMENT = 'nib-attachment';

// claimable says whether an mdast link is one this node can carry without
// losing anything.
//
// Two conditions, and both matter. The href has to be an attachment nib
// itself wrote - storedName anchors the pattern at both ends, so a remote URL
// ending the same way is not mistaken for one. And the link's text has to be
// a single plain run: `[**the brief**](...)` holds a mark this node has
// nowhere to put, so it stays an ordinary link rather than being flattened.
//
// Images are deliberately not claimed. Milkdown's own image nodes already own
// them, and a second claimant is a conflict, not a feature.
function claimable(node) {
  if (node.type !== 'link') return false;
  const name = storedName(node.url);
  if (!name) return false;
  if (node.title) return false; // a title is a slot this node does not carry
  const [only, ...rest] = node.children ?? [];
  return rest.length === 0 && only?.type === 'text';
}

export const attachmentSchema = $nodeSchema(ATTACHMENT, () => ({
  // Inline, because the link it replaces can sit mid-sentence: `See [x](y)
  // for the rest.` A block here would tear the paragraph in half. It draws
  // itself as a box through display, not through the schema.
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,
  attrs: {
    src: { default: '' },
    text: { default: '' },
  },
  parseDOM: [
    {
      tag: `span[data-type="${ATTACHMENT}"]`,
      getAttrs: (dom) => ({
        src: dom.getAttribute('data-src') || '',
        text: dom.getAttribute('data-text') || '',
      }),
    },
  ],
  toDOM: (node) => [
    'span',
    {
      'data-type': ATTACHMENT,
      'data-src': node.attrs.src,
      'data-text': node.attrs.text,
      'data-kind': kindOf(storedName(node.attrs.src) || ''),
    },
  ],
  parseMarkdown: {
    match: claimable,
    runner: (state, node, type) => {
      state.addNode(type, {
        src: node.url,
        text: node.children?.[0]?.value ?? '',
      });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === ATTACHMENT,
    runner: (state, node) => {
      // Built as mdast rather than as a string, so remark does the escaping.
      // A filename holding a bracket comes back out with the bracket escaped
      // the way it went in, which hand-assembling the link would get wrong.
      state.openNode('link', undefined, { url: node.attrs.src, title: null });
      state.addNode('text', undefined, node.attrs.text);
      state.closeNode();
    },
  },
}));
