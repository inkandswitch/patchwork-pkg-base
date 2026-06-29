import type { ToolSlot } from "../types";

/** The id that identifies a slot regardless of its kind (tool tuple or component string). */
export const slotId = (slot: ToolSlot): string =>
  typeof slot === "string" ? slot : slot[0];

/**
 * Render one configured tool-lane slot (doctitle / sidebar / tray / contextbar).
 *
 * A bare string is a `patchwork:component` id, loaded and rendered with no
 * document. A `[toolId, docId]` tuple renders that tool against the doc the
 * tuple itself names — each slot carries its own document.
 */
export function SlotView(props: { slot: ToolSlot }) {
  return typeof props.slot === "string" ? (
    <patchwork-view component={props.slot} />
  ) : (
    <patchwork-view doc-url={props.slot[1]} tool-id={props.slot[0]} />
  );
}
