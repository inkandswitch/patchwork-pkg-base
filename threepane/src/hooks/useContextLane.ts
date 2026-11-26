import { createMemo, type Accessor } from "solid-js";
import type { ContextLaneConfig } from "../types";
import { contextLane, type LaneItem } from "../layoutEdits";
import { useComponentName, useTaggedComponents } from "./useTaggedComponents";

/**
 * The context tabs: every component tagged `"context-tool"`, with the person's
 * edits from the config doc applied (see ContextLaneConfig).
 *
 * - `shown` / `hidden`: the tabs in the bar, and the ones hidden from it.
 * - `addable`: the tagged components the "+" offers, i.e. every one that isn't
 *   showing (hidden and removed ones included).
 * - `exists`: whether there's a context sidebar at all — anything tagged, or
 *   anything added by hand. It stays when every tab has been hidden or
 *   removed, so the "+" is still there to bring one back.
 */
export function useContextLane(config: Accessor<ContextLaneConfig | undefined>) {
  const tagged = useTaggedComponents("context-tool");
  const name = useComponentName();

  const lane = createMemo(() => contextLane(tagged(), config(), name));
  const shown = () => lane().shown;
  const hidden = () => lane().hidden;
  const addable = createMemo<LaneItem[]>(() => {
    const showing = new Set(shown().map((item) => item.id));
    return tagged().filter((item) => !showing.has(item.id));
  });
  const exists = () => tagged().length > 0 || !!config()?.added?.length;

  return { shown, hidden, addable, exists };
}
