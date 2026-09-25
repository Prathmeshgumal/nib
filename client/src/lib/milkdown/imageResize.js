import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { sizeFor } from '@/lib/mediaSize';
import { storedName } from '@/lib/attachments';
import { makeGrip } from './resize';

// Images are drawn by Milkdown's own nodes, not by nib's, so the resize grip
// v1.5.0 gave them is added from the outside as a decoration.
//
// Decorations are the reason this is safe: they draw extra DOM and set extra
// attributes without touching the document, so nothing here can reach the
// markdown. Claiming images with a node of our own would have meant a second
// owner for them and another serializer to get wrong - the way the image
// component already lost the alt text once.
const key = new PluginKey('NIB_IMAGE_RESIZE');

// The nodes Milkdown uses for a picture: one block, one inline. The attachment
// node is deliberately absent - it draws its own grip, and two would fight.
const IMAGE_NODES = new Set(['image', 'image-block', 'image-inline']);

function media(grip) {
  // The widget is drawn immediately after the image it belongs to.
  const before = grip.previousElementSibling;
  if (!before) return null;
  return before.matches('img') ? before : before.querySelector('img');
}

export const imageResize = $prose(
  () =>
    new Plugin({
      key,
      props: {
        decorations(state) {
          const found = [];
          state.doc.descendants((node, pos) => {
            if (!IMAGE_NODES.has(node.type.name)) return;
            const name = storedName(node.attrs?.src);
            // A picture from somewhere else on the web: its width is nothing
            // we can key on, and it is not ours to size.
            if (!name) return;

            const attrs = { class: 'nib-media nib-media-image', 'data-nib-file': name };
            const width = sizeFor(name);
            if (width !== null) attrs.style = `width:${width}px`;

            found.push(Decoration.node(pos, pos + node.nodeSize, attrs));
            found.push(
              Decoration.widget(pos + node.nodeSize, () => makeGrip(name, media), { side: 1 }),
            );
          });
          return DecorationSet.create(state.doc, found);
        },
      },
    }),
);
