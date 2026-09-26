// Editing a block, kept apart from both the menu that offers it and the
// pointer handling that opens the menu. Working out which block sits under a
// pointer needs layout, which jsdom does not have; working out what to do with
// that block does not. Everything here is therefore testable, and is tested.

// The top-level block containing a position - the unit the handle addresses.
// A paragraph nested three lists deep still belongs to whichever block sits
// directly under the document, because that is the thing the handle is beside.
export function blockRangeAt(doc, pos) {
  if (pos == null || pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  const from = $pos.depth === 0 ? $pos.pos : $pos.before(1);
  const node = doc.nodeAt(from);
  if (!node) return null;
  return { from, to: from + node.nodeSize, node };
}

export function deleteBlock(state, dispatch, range) {
  if (!range) return false;
  dispatch?.(state.tr.delete(range.from, range.to).scrollIntoView());
  return true;
}

export function duplicateBlock(state, dispatch, range) {
  if (!range) return false;
  // Inserted at the end of the block rather than the start, so the copy lands
  // under the original and the original keeps its place.
  dispatch?.(state.tr.insert(range.to, range.node).scrollIntoView());
  return true;
}

// The block an action should act on. Every route into the menu leaves the
// selection inside the block in question, so there is one answer rather than
// several.
export function targetRange(state) {
  return blockRangeAt(state.doc, state.selection.from);
}
