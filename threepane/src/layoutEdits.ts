import type { ContextLaneConfig, ThreepaneConfigDoc } from "./types";
import { slotId } from "./components/SlotView";

/**
 * Asked for by the tab bar and the top bar when someone adds, removes, hides
 * or shows one of their tools. It bubbles and is composed, so the frame that
 * owns the threepane config doc answers it wherever the document area is
 * mounted (inline, or by a host). See `handleLayoutEdits`.
 */
export const EDIT_LAYOUT_EVENT = "threepane:edit-layout";

export type LayoutEdit =
  | { lane: "context"; action: "add" | "remove" | "hide" | "show"; id: string }
  | { lane: "doctitle"; action: "remove" | "hide" | "show"; id: string };

export function dispatchLayoutEdit(from: Element, edit: LayoutEdit) {
  from.dispatchEvent(
    new CustomEvent<LayoutEdit>(EDIT_LAYOUT_EVENT, {
      detail: edit,
      bubbles: true,
      composed: true,
    })
  );
}

/** Splice every `id` out of `list`, in place. */
function drop(list: string[] | undefined, id: string) {
  if (!list) return;
  for (let i = list.length - 1; i >= 0; i--) {
    if (String(list[i]) === id) list.splice(i, 1);
  }
}

function include(list: string[], id: string) {
  if (!list.some((existing) => String(existing) === id)) list.push(id);
}

/** Apply one edit to the config doc, inside a `change`. */
export function applyLayoutEdit(doc: ThreepaneConfigDoc, edit: LayoutEdit) {
  const { id } = edit;
  if (!id) return;

  if (edit.lane === "context") {
    if (!doc.context) doc.context = {};
    const lane = doc.context;
    switch (edit.action) {
      case "add":
        drop(lane.removed, id);
        drop(lane.hidden, id);
        if (!lane.added) lane.added = [];
        include(lane.added, id);
        return;
      case "remove":
        drop(lane.added, id);
        drop(lane.hidden, id);
        if (!lane.removed) lane.removed = [];
        include(lane.removed, id);
        return;
      case "hide":
        if (!lane.hidden) lane.hidden = [];
        include(lane.hidden, id);
        return;
      case "show":
        drop(lane.hidden, id);
        return;
    }
  }

  if (!doc.doctitle) doc.doctitle = { tools: [] };
  const doctitle = doc.doctitle;
  switch (edit.action) {
    case "remove": {
      const tools = doctitle.tools ?? [];
      for (let i = tools.length - 1; i >= 0; i--) {
        if (slotId(tools[i]) === id) tools.splice(i, 1);
      }
      drop(doctitle.hidden, id);
      return;
    }
    case "hide":
      if (!doctitle.hidden) doctitle.hidden = [];
      include(doctitle.hidden, id);
      return;
    case "show":
      drop(doctitle.hidden, id);
      return;
  }
}

export type LaneItem = { id: string; name: string };

/**
 * The context tabs, from the registry's tagged components and the person's
 * edits: `shown` in the bar, `hidden` from it, in bar order (tagged first, by
 * name, then the hand-added ones in the order they were added). `name` names a
 * hand-added id that isn't a tagged component.
 */
export function contextLane(
  tagged: LaneItem[],
  config: ContextLaneConfig | undefined,
  name: (id: string) => string = (id) => id
): { shown: LaneItem[]; hidden: LaneItem[] } {
  const removed = new Set((config?.removed ?? []).map(String));
  const hidden = new Set((config?.hidden ?? []).map(String));
  const seen = new Set<string>();
  const all: LaneItem[] = [];
  for (const item of tagged) {
    if (removed.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    all.push(item);
  }
  for (const raw of config?.added ?? []) {
    const id = String(raw);
    if (removed.has(id) || seen.has(id)) continue;
    seen.add(id);
    all.push({ id, name: name(id) });
  }
  return {
    shown: all.filter((item) => !hidden.has(item.id)),
    hidden: all.filter((item) => hidden.has(item.id)),
  };
}

/**
 * Answer `threepane:edit-layout` events from inside `element` by applying them
 * to the config doc through `change`.
 */
export function handleLayoutEdits(
  element: HTMLElement,
  change: (fn: (doc: ThreepaneConfigDoc) => void) => void
) {
  const onEdit = (event: Event) => {
    const edit = (event as CustomEvent<LayoutEdit>).detail;
    if (!edit?.id) return;
    event.stopPropagation();
    change((doc) => applyLayoutEdit(doc, edit));
  };
  element.addEventListener(EDIT_LAYOUT_EVENT, onEdit);
  return () => element.removeEventListener(EDIT_LAYOUT_EVENT, onEdit);
}
