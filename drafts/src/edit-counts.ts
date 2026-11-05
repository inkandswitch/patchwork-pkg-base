import type { AutomergeUrl, Repo } from "@automerge/automerge-repo/slim";
import * as Automerge from "@automerge/automerge/slim";

import { editCounter, type EditCounts } from "./history/edit-counts.js";

// Work out one change's rough edit magnitude by diffing it against its parents
// and counting its patches: splice lengths and insert counts as additions, del
// lengths as deletions, everything else (put / inc / mark / …) as one addition.
// `@patchwork` metadata paths are ignored. A pure function of immutable
// history, so each change is diffed once, here, and only the group aggregates
// are kept.
export function computeEditCounts(
  doc: Automerge.Doc<unknown>,
  hash: string,
  deps: string[]
): { additions: number; deletions: number } {
  try {
    return countPatches(
      Automerge.diff(
        doc,
        deps as unknown as Automerge.Heads,
        [hash] as unknown as Automerge.Heads
      )
    );
  } catch (err) {
    console.warn("[drafts] failed to diff change for edit counts:", hash, err);
    return { additions: 0, deletions: 0 };
  }
}

// The same +/- magnitude over an arbitrary head range (`from` → `to`), e.g.
// the eye's diff span between the baseline and the scrubbed head.
export function computeRangeEditCounts(
  doc: Automerge.Doc<unknown>,
  from: string[],
  to: string[]
): { additions: number; deletions: number } {
  try {
    return countPatches(
      Automerge.diff(
        doc,
        from as unknown as Automerge.Heads,
        to as unknown as Automerge.Heads
      )
    );
  } catch (err) {
    console.warn("[drafts] failed to diff range for edit counts:", err);
    return { additions: 0, deletions: 0 };
  }
}

// The same +/- magnitude for every change since `since`, straight from each
// change's own ops and keyed by hash: every insert / set / make / mark counts
// as one addition, every del as one deletion (a text splice is one op per
// character, so the totals match the patch-based count). Ops under
// `@patchwork` are ignored: the skip set starts from the objects currently in
// that subtree and, since changes come back in causal order, picks up objects
// created inside it along the way.
export async function editCountsSince(
  doc: Automerge.Doc<unknown>,
  since: Automerge.Heads,
  tick: () => Promise<boolean> = async () => true
): Promise<Map<string, EditCounts> | null> {
  const count = editCounter(doc);
  const counts = new Map<string, EditCounts>();
  for (const change of Automerge.getChangesSince(doc, since)) {
    if (!(await tick())) return null;
    const decoded = Automerge.decodeChange(change);
    counts.set(decoded.hash, count(decoded));
  }
  return counts;
}


// Shared patch-counting rules for the two diff flavors above.
function countPatches(patches: Automerge.Patch[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const patch of patches) {
    if (patch.path[0] === "@patchwork") continue;
    if (patch.action === "splice") {
      additions += (patch.value as string).length;
    } else if (patch.action === "insert") {
      additions += Array.isArray((patch as { values?: unknown[] }).values)
        ? (patch as { values: unknown[] }).values.length
        : 1;
    } else if (patch.action === "del") {
      deletions += (patch as { length?: number }).length ?? 1;
    } else {
      additions += 1;
    }
  }
  return { additions, deletions };
}

// When was a document created, as a Unix SECONDS timestamp? Reads the doc's
// full history and returns its first change's time (the creation change).
// Returns undefined when the doc, its history, or that time can't be resolved,
// in which case callers skip the "before creation" filter rather than hiding
// everything. Immutable once known, so resolved times are cached per url.
export async function getDocCreationTime(
  repo: Repo,
  url: AutomergeUrl | undefined
): Promise<number | undefined> {
  if (!url) return undefined;
  const cached = creationTimes.get(url);
  if (cached !== undefined) return cached;
  try {
    const handle = await repo.find<unknown>(url);
    const doc = handle.doc();
    if (!doc) return undefined;
    const metas = Automerge.getChangesMetaSince(doc, []);
    const time = metas[0]?.time || undefined;
    if (time !== undefined) creationTimes.set(url, time);
    return time;
  } catch (err) {
    console.warn("[drafts] failed to resolve creation time for:", url, err);
    return undefined;
  }
}

const creationTimes = new Map<AutomergeUrl, number>();
