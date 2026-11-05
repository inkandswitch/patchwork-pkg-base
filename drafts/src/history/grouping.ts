import type { GroupKey, Heads, HistoryGroup } from "./types.js";

// Changes by one actor more than this far apart start a new group. Part of
// the index format: changing it means bumping the database version.
export const GROUP_GAP_MS = 5 * 60 * 1000;

export type IndexedChange = {
  actor: string;
  hash: string;
  deps: Heads;
  time: number;
  additions: number;
  deletions: number;
};

// Each actor's groups, sorted by start time. They never overlap: anything
// within the gap of each other is one group.
export type ActorGroups = Map<string, HistoryGroup[]>;

// What a batch of changes did to the stored groups, keyed by `groupKey`.
export type GroupDelta = {
  upsert: Map<string, HistoryGroup>;
  remove: Map<string, GroupKey>;
};

export function emptyDelta(): GroupDelta {
  return { upsert: new Map(), remove: new Map() };
}

// Fold one change into its actor's groups. The change joins every group
// within the gap of it, which merges groups it bridges. Changes have to come
// in causal order, so each one is the newest of its actor's chain.
export function addChange(
  byActor: ActorGroups,
  change: IndexedChange,
  delta: GroupDelta
): void {
  let groups = byActor.get(change.actor);
  if (!groups) byActor.set(change.actor, (groups = []));
  const touching = touchingGroups(groups, change.time);

  const merged = touching.length
    ? mergeGroups(touching.map((i) => groups[i]))
    : groupOf(change);
  if (touching.length) extendGroup(merged, change);

  for (const i of touching) {
    const key = groupKey(groups[i]);
    delta.upsert.delete(key);
    delta.remove.set(key, { actor: change.actor, fromHeads: groups[i].fromHeads });
  }
  const key = groupKey(merged);
  delta.remove.delete(key);
  delta.upsert.set(key, merged);

  const at = touching.length ? touching[0] : insertionIndex(groups, merged.startTime);
  groups.splice(at, touching.length, merged);
}

// The heads after applying `change` on top of `heads`.
export function advanceHeads(heads: Set<string>, change: { hash: string; deps: Heads }): void {
  for (const dep of change.deps) heads.delete(dep);
  heads.add(change.hash);
}

export function groupKey(group: GroupKey): string {
  return `${group.actor}|${group.fromHeads.join(",")}`;
}

export function sortedHeads(heads: readonly string[]): Heads {
  return [...heads].sort();
}

export function sameHeads(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((h) => set.has(h));
}

// Indices of the groups within the gap of `time`, oldest first. Groups are
// disjoint and sorted, so their ends are sorted too.
function touchingGroups(groups: HistoryGroup[], time: number): number[] {
  const ms = time * 1000;
  const out: number[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    if (group.startTime * 1000 - GROUP_GAP_MS > ms) continue;
    if (group.endTime * 1000 + GROUP_GAP_MS < ms) break;
    out.unshift(i);
  }
  return out;
}

function mergeGroups(oldestFirst: HistoryGroup[]): HistoryGroup {
  const first = oldestFirst[0];
  const merged: HistoryGroup = { ...first };
  for (const group of oldestFirst.slice(1)) {
    if (group.endTime >= merged.endTime) {
      merged.endTime = group.endTime;
      merged.toHeads = group.toHeads;
    }
    merged.additions += group.additions;
    merged.deletions += group.deletions;
    merged.changeCount += group.changeCount;
  }
  return merged;
}

// The change is causally newest of its actor, so it takes the group's end
// unless its clock reads earlier than the group's last change.
function extendGroup(group: HistoryGroup, change: IndexedChange): void {
  if (change.time < group.startTime) {
    group.startTime = change.time;
    group.fromHeads = sortedHeads(change.deps);
  }
  if (change.time >= group.endTime) {
    group.endTime = change.time;
    group.toHeads = [change.hash];
  }
  group.additions += change.additions;
  group.deletions += change.deletions;
  group.changeCount += 1;
}

function groupOf(change: IndexedChange): HistoryGroup {
  return {
    actor: change.actor,
    fromHeads: sortedHeads(change.deps),
    toHeads: [change.hash],
    startTime: change.time,
    endTime: change.time,
    additions: change.additions,
    deletions: change.deletions,
    changeCount: 1,
  };
}

function insertionIndex(groups: HistoryGroup[], startTime: number): number {
  let i = groups.length;
  while (i > 0 && groups[i - 1].startTime > startTime) i--;
  return i;
}
