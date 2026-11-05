import {
  decodeHeads,
  type AutomergeUrl,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";
import { subscribe } from "@inkandswitch/patchwork-providers";

import type { ChangeGroup, DraftMemberDoc } from "./draft-types.js";
import {
  HISTORY_GROUPS_SELECTOR,
  type HistoryGroup as Group,
  type HistoryGroupsUpdate as GroupsUpdate,
} from "./history/types.js";

// Groups from any member and actor closer than this read as one row.
export const TIMELINE_GAP_MS = 5 * 60 * 1000;

// A subscription nobody answered is asked again this often: the history
// provider loads lazily and isn't waited on.
const UNANSWERED_RETRY_MS = 3000;

type HistoryGroup = Group<UrlHeads>;
type HistoryGroupsUpdate = GroupsUpdate<UrlHeads>;

export type MemberHistory = {
  memberUrl: AutomergeUrl;
  groups: HistoryGroup[];
  // not answered yet, or still indexing
  pending: boolean;
};

// Follow each member's history since its fork point. `onChange` gets every
// member's current groups whenever one of them moves.
export function watchMemberHistories(
  element: HTMLElement,
  members: DraftMemberDoc[],
  onChange: (histories: MemberHistory[]) => void
): () => void {
  const state = members.map((member) => ({
    memberUrl: member.url,
    groups: new Map<string, HistoryGroup>(),
    pending: true,
  }));
  const emit = () =>
    onChange(
      state.map(({ memberUrl, groups, pending }) => ({
        memberUrl,
        groups: [...groups.values()],
        pending,
      }))
    );
  const stops = members.map((member, i) =>
    watchMember(element, member, (update) => {
      applyUpdate(state[i], update);
      emit();
    })
  );
  emit();
  return () => {
    for (const stop of stops) stop();
  };
}

// Whether two member lists watch the same histories.
export function sameMembers(a: DraftMemberDoc[], b: DraftMemberDoc[]): boolean {
  if (a.length !== b.length) return false;
  const key = (m: DraftMemberDoc) =>
    `${m.url}|${m.cloneUrl ?? ""}|${[...(m.clonedAt ?? [])].sort().join(",")}`;
  const keys = new Set(a.map(key));
  return b.every((m) => keys.has(key(m)));
}

// Stitch the members' per-actor groups into the timeline's rows, newest
// first: sorted by start, a group joins the row before it unless a pause
// longer than the gap separates them. Rows are therefore disjoint in time, so
// a row's changes are exactly the members' changes inside its span. Rows that
// end before `createdAt` (history a member brought along from before the
// timeline's root existed) are dropped whole.
export function combineHistories(
  histories: MemberHistory[],
  { gapMs = TIMELINE_GAP_MS, createdAt }: { gapMs?: number; createdAt?: number } = {}
): ChangeGroup[] {
  const sources = histories
    .flatMap(({ memberUrl, groups }) => groups.map((group) => ({ memberUrl, group })))
    .sort(
      (a, b) =>
        a.group.startTime - b.group.startTime ||
        compare(a.memberUrl, b.memberUrl) ||
        compare(a.group.actor, b.group.actor)
    );

  const rows: Row[] = [];
  for (const source of sources) {
    const row = rows[rows.length - 1];
    if (row && source.group.startTime * 1000 <= row.endTime * 1000 + gapMs) {
      addToRow(row, source.memberUrl, source.group);
    } else {
      rows.push(startRow(source.memberUrl, source.group));
    }
  }
  return rows
    .filter((row) => createdAt === undefined || row.endTime >= createdAt)
    .reverse()
    .map(finishRow);
}

type Row = {
  startTime: number;
  endTime: number;
  newestMemberUrl: AutomergeUrl;
  newestHash: string;
  actorEnds: Map<string, number>;
  additions: number;
  deletions: number;
  changeCount: number;
};

function startRow(memberUrl: AutomergeUrl, group: HistoryGroup): Row {
  return {
    startTime: group.startTime,
    endTime: group.endTime,
    newestMemberUrl: memberUrl,
    newestHash: decodeHeads(group.toHeads)[0],
    actorEnds: new Map([[group.actor, group.endTime]]),
    additions: group.additions,
    deletions: group.deletions,
    changeCount: group.changeCount,
  };
}

function addToRow(row: Row, memberUrl: AutomergeUrl, group: HistoryGroup): void {
  if (group.endTime > row.endTime) {
    row.endTime = group.endTime;
    row.newestMemberUrl = memberUrl;
    row.newestHash = decodeHeads(group.toHeads)[0];
  }
  row.actorEnds.set(
    group.actor,
    Math.max(row.actorEnds.get(group.actor) ?? -Infinity, group.endTime)
  );
  row.additions += group.additions;
  row.deletions += group.deletions;
  row.changeCount += group.changeCount;
}

function finishRow(row: Row): ChangeGroup {
  return {
    id: `tg-${row.newestHash}`,
    startTime: row.startTime,
    endTime: row.endTime,
    newestMemberUrl: row.newestMemberUrl,
    newestHash: row.newestHash,
    actors: [...row.actorEnds.entries()]
      .sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))
      .map(([actor]) => actor),
    additions: row.additions,
    deletions: row.deletions,
    changeCount: row.changeCount,
  };
}

function watchMember(
  element: HTMLElement,
  member: DraftMemberDoc,
  onUpdate: (update: HistoryGroupsUpdate) => void
): () => void {
  const selector = {
    type: HISTORY_GROUPS_SELECTOR,
    url: member.cloneUrl ?? member.url,
    fromHeads: member.clonedAt ?? [],
  };
  let answered = false;
  const open = () =>
    subscribe<HistoryGroupsUpdate>(element, selector, (update) => {
      answered = true;
      onUpdate(update);
    });
  let unsubscribe = open();
  const retry = setInterval(() => {
    if (answered) return clearInterval(retry);
    unsubscribe();
    unsubscribe = open();
  }, UNANSWERED_RETRY_MS);
  return () => {
    clearInterval(retry);
    unsubscribe();
  };
}

function applyUpdate(
  member: { groups: Map<string, HistoryGroup>; pending: boolean },
  update: HistoryGroupsUpdate
): void {
  if (update.reset) member.groups.clear();
  for (const key of update.remove) member.groups.delete(groupKey(key));
  for (const group of update.upsert) member.groups.set(groupKey(group), group);
  member.pending = update.pending;
}

function groupKey(key: { actor: string; fromHeads: UrlHeads }): string {
  return `${key.actor}|${[...key.fromHeads].sort().join(",")}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
