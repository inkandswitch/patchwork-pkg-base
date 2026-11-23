import type { EditorState } from "@codemirror/state";

/**
 * Whether a non-empty selection covers any of `from..to`.
 *
 * drawSelection paints the selection in a layer behind the text, so anything
 * opaque drawn over selected markup (an embed's frame) hides it; that asks
 * this, and tints itself.
 */
export function selectedOver(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some((r) => !r.empty && r.from < to && r.to > from);
}
