import type { EditorState } from "@codemirror/state";

/**
 * Whether a non-empty selection covers any of `from..to`.
 *
 * There's no drawSelection here: the browser draws the selection, and it
 * doesn't paint widgets. So what's drawn over hidden markup (list markers,
 * quote bars, heading labels, embeds, …) asks this, and tints itself.
 */
export function selectedOver(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some((r) => !r.empty && r.from < to && r.to > from);
}
