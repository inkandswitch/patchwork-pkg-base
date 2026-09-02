import {
  decodeHeads,
  type AutomergeUrl,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";

// Which changes did a merged draft contribute? Ported from patchwork-24's
// getChangesFromMergedBranch: the draft's clone entry brackets its
// contribution per member doc — fork point (`clonedAt` -> `baseHeads`) and
// the clone's heads at merge time (`mergedFrom` -> `mergeHeads`) — and a
// backwards walk over the change DAG between the two recovers exactly the
// change hashes in between. Unlike patchwork-24 there is no main-side
// subtraction: drafts only ever merges child into parent, never parent into
// child, so nothing of the parent's is reachable from the clone's merge
// heads beyond the fork point.

// A merged draft as the grouper sees it: which draft, its display name, and
// per member doc the head range its contribution spans. Built by the
// draft-state provider from the merged DraftDoc's clone entries, and
// persisted onto the merge group (`ChangeGroup.merge.members`) so the
// sidebar can re-run the walk without loading the DraftDoc.
export type MergedDraftSpec = {
  url: AutomergeUrl;
  name: string | null;
  members: Record<AutomergeUrl, { baseHeads: UrlHeads; mergeHeads: UrlHeads }>;
};

// The subset of a change's metadata the walk needs; satisfied by both the
// grouper's PendingChange rows and Automerge's DecodedChange/ChangeMetadata.
export type ChangeMetaLike = { hash: string; deps: string[] };

type AttributableRow = ChangeMetaLike & { memberUrl: AutomergeUrl };

// Split a timeline's rows into the changes each merged draft contributed
// (keyed by draft url, preserving the input order) and the rest. The rest
// goes through the normal inactivity-gap grouping; each merged draft's rows
// become one dedicated group. A hash claimed by several drafts (a nested
// merge whose ranges overlap) goes to the first claimant.
export function partitionRows<Row extends AttributableRow>(
  rows: Row[],
  mergedDrafts: MergedDraftSpec[]
): { merged: Map<AutomergeUrl, Row[]>; rest: Row[] } {
  const merged = new Map<AutomergeUrl, Row[]>();
  if (mergedDrafts.length === 0) return { merged, rest: rows };

  const rowsByMember = new Map<AutomergeUrl, Row[]>();
  for (const row of rows) {
    let list = rowsByMember.get(row.memberUrl);
    if (!list) rowsByMember.set(row.memberUrl, (list = []));
    list.push(row);
  }

  // Change hash -> the merged draft that contributed it.
  const owner = new Map<string, AutomergeUrl>();
  for (const draft of mergedDrafts) {
    merged.set(draft.url, []);
    for (const [memberUrl, range] of Object.entries(draft.members)) {
      const memberRows = rowsByMember.get(memberUrl as AutomergeUrl);
      if (!memberRows) continue;
      const hashes = attributedHashes(
        memberRows,
        decodeHeads(range.mergeHeads),
        decodeHeads(range.baseHeads)
      );
      for (const hash of hashes) {
        if (!owner.has(hash)) owner.set(hash, draft.url);
      }
    }
  }

  const rest: Row[] = [];
  for (const row of rows) {
    const draftUrl = owner.get(row.hash);
    if (draftUrl) {
      merged.get(draftUrl)!.push(row);
    } else {
      rest.push(row);
    }
  }
  return { merged, rest };
}

// The frontier of a change set: the hashes no OTHER change in the set lists
// among its deps — i.e. the heads describing exactly the state made of these
// changes (plus their ancestry). Used by the sidebar's scrub boundaries: the
// rows rendered below a boundary can be mutually concurrent (a merge group
// interleaved in time with regular edits), so the boundary pins to this
// multi-head frontier instead of the single newest-by-wall-clock change.
// Deps pointing outside the set (older history) are ignored. Assumes no
// causal chain between two set members passes through a change outside the
// set — true for a timeline's rows, where anything below a row's dependents
// is included with it.
export function frontierHashes(rows: ChangeMetaLike[]): string[] {
  const depended = new Set<string>();
  for (const row of rows) {
    for (const dep of row.deps) depended.add(dep);
  }
  return rows.filter((row) => !depended.has(row.hash)).map((row) => row.hash);
}

// Walk the change DAG backwards from `mergeHeads` over `deps`, stopping at
// `baseHeads`; the hashes visited are the merged draft's contribution.
// Deviations from patchwork-24's getHashesBetweenHeads: a stop-head only
// ends its own branch of the walk rather than aborting the whole traversal
// (drafts merges routinely produce multi-head frontiers), and a hash missing
// from `metas` is treated as a stop rather than an error (the grouper's
// pre-creation-time filter can drop rows from the window).
export function attributedHashes(
  metas: ChangeMetaLike[],
  mergeHeads: string[],
  baseHeads: string[]
): Set<string> {
  const byHash = new Map(metas.map((meta) => [meta.hash, meta]));
  const stop = new Set(baseHeads);
  const attributed = new Set<string>();
  const workQueue = [...mergeHeads];

  let hash: string | undefined;
  while ((hash = workQueue.pop())) {
    if (stop.has(hash) || attributed.has(hash)) continue;
    const meta = byHash.get(hash);
    if (!meta) continue;
    attributed.add(hash);
    workQueue.push(...meta.deps);
  }
  return attributed;
}
