import * as Automerge from "@automerge/automerge/slim";

export type EditCounts = { additions: number; deletions: number };

// Counts each change's edits from its own ops: every insert, set, make or
// mark is one addition and every del one deletion (a text splice is one op
// per character). Ops under `@patchwork` don't count. The skip set starts from
// the objects in that subtree now and, since changes have to be counted in
// causal order, picks up objects made inside it along the way.
export function editCounter(
  doc: Automerge.Doc<unknown>
): (change: Automerge.DecodedChange) => EditCounts {
  const skipObjs = new Set<string>();
  objectIdsUnder((doc as Record<string, unknown>)["@patchwork"], skipObjs);
  return (change) => countOps(change, skipObjs);
}

function countOps(
  change: Automerge.DecodedChange,
  skipObjs: Set<string>
): EditCounts {
  let additions = 0;
  let deletions = 0;
  change.ops.forEach((op, i) => {
    const skipped =
      skipObjs.has(op.obj) || (op.obj === "_root" && op.key === "@patchwork");
    if (op.action.startsWith("make") && skipped) {
      skipObjs.add(`${change.startOp + i}@${change.actor}`);
    }
    if (skipped || op.action === "markEnd") return;
    if (op.action === "del") deletions += 1;
    else additions += 1;
  });
  return { additions, deletions };
}

// Object ids of a materialized container and everything inside it, including
// the text objects behind string values in maps (strings inside lists carry
// no reachable id).
function objectIdsUnder(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== "object") return;
  const id = Automerge.getObjectId(value);
  if (id) out.add(id);
  if (Array.isArray(value)) {
    for (const item of value) objectIdsUnder(item, out);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string") {
      const textId = Automerge.getObjectId(value, key);
      if (typeof textId === "string") out.add(textId);
    } else {
      objectIdsUnder(child, out);
    }
  }
}
