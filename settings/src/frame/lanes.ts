// the shape of threepane's config doc, as much of it as settings edits, and
// the rules for its lanes. these are threepane's (threepane/src/layoutEdits.ts)
// copied, not imported: a package doesn't reach into another one's source

export type ToolSlot = [toolId: string, docId: string] | string;

/**
 * the context tabs are every `patchwork:component` tagged "context-tool";
 * this is the person's edits on top of that, as component ids. `added`:
 * untagged ones added by hand, in order, after the tagged ones. `removed`:
 * tagged ones taken out. `hidden`: still in the list, but not shown
 */
export type ContextLaneConfig = {
  added?: string[];
  removed?: string[];
  hidden?: string[];
};

export type ThreepaneConfigDoc = {
  doctitle?: { tools?: ToolSlot[]; hidden?: string[] };
  context?: ContextLaneConfig;
};

export type LaneItem = { id: string; name: string };

// a string slot can come back from automerge as an object (a RawString), so
// it's the tuples that get told apart, not the strings
export const slotId = (slot: ToolSlot) =>
  Array.isArray(slot) ? String(slot[0]) : String(slot);

function drop(list: string[] | undefined, id: string) {
  if (!list) return;
  for (let i = list.length - 1; i >= 0; i--) {
    if (String(list[i]) === id) list.splice(i, 1);
  }
}

function include(list: string[], id: string) {
  if (!list.some((existing) => String(existing) === id)) list.push(id);
}

/**
 * the context tabs in bar order: tagged first (in the order given), then the
 * hand-added ones in the order they were added. `name` names an added id
 * that isn't one of the tagged components
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

export type ContextEdit = "add" | "remove" | "hide" | "show";

/** one edit to the context tabs, inside a `change` */
export function editContext(
  doc: ThreepaneConfigDoc,
  action: ContextEdit,
  id: string
) {
  if (!id) return;
  doc.context ??= {};
  const lane = doc.context;
  switch (action) {
    case "add":
      drop(lane.removed, id);
      drop(lane.hidden, id);
      lane.added ??= [];
      include(lane.added, id);
      return;
    case "remove":
      drop(lane.added, id);
      drop(lane.hidden, id);
      lane.removed ??= [];
      include(lane.removed, id);
      return;
    case "hide":
      lane.hidden ??= [];
      include(lane.hidden, id);
      return;
    case "show":
      drop(lane.hidden, id);
      return;
  }
}

export type TitlebarEdit =
  | { action: "add" | "remove" | "hide" | "show"; id: string }
  | { action: "move"; from: number; to: number };

/**
 * one edit to the title bar's tools, inside a `change`. a slot keeps its
 * shape when it moves: a `[toolId, docId]` pin stays a pin
 */
export function editTitlebar(doc: ThreepaneConfigDoc, edit: TitlebarEdit) {
  doc.doctitle ??= {};
  const doctitle = doc.doctitle;
  doctitle.tools ??= [];
  const tools = doctitle.tools;

  if (edit.action === "move") {
    const { from, to } = edit;
    if (from === to || !tools[from] || to < 0 || to >= tools.length) return;
    const slot = tools[from];
    const copy: ToolSlot = Array.isArray(slot)
      ? [String(slot[0]), String(slot[1])]
      : String(slot);
    tools.splice(from, 1);
    tools.splice(to, 0, copy);
    return;
  }

  const id = edit.id.trim();
  if (!id) return;
  switch (edit.action) {
    case "add":
      if (!tools.some((slot) => slotId(slot) === id)) tools.push(id);
      drop(doctitle.hidden, id);
      return;
    case "remove":
      for (let i = tools.length - 1; i >= 0; i--) {
        if (slotId(tools[i]) === id) tools.splice(i, 1);
      }
      drop(doctitle.hidden, id);
      return;
    case "hide":
      doctitle.hidden ??= [];
      include(doctitle.hidden, id);
      return;
    case "show":
      drop(doctitle.hidden, id);
      return;
  }
}

/** options whose name or id has `query` in it, case-insensitively */
export function filterOptions<T extends LaneItem>(options: T[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (option) =>
      option.name.toLowerCase().includes(q) ||
      option.id.toLowerCase().includes(q)
  );
}
