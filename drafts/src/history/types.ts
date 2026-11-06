export const HISTORY_GROUPS_SELECTOR = "history:groups";

// Automerge's hex change hashes, sorted. The worker and IndexedDB use these;
// the provider converts to and from `UrlHeads` at the subscription boundary.
export type Heads = string[];

// One actor's burst of editing: consecutive changes no more than the group
// gap apart. Times are Automerge change times, in seconds.
export type HistoryGroup<H extends string[] = Heads> = {
  actor: string;
  // the heads before the group's first change
  fromHeads: H;
  // the group's last change
  toHeads: H;
  startTime: number;
  endTime: number;
  additions: number;
  deletions: number;
  changeCount: number;
};

// Unique per index: an actor's changes form a chain, so no two of its groups
// start from the same heads.
export type GroupKey<H extends string[] = Heads> = {
  actor: string;
  fromHeads: H;
};

export type HistoryGroupsUpdate<H extends string[] = Heads> = {
  // the first answer, and after the index was rebuilt: drop everything held
  reset: boolean;
  upsert: HistoryGroup<H>[];
  remove: GroupKey<H>[];
  // the document heads the groups cover
  toHeads: H;
  // the index is behind the document and still catching up
  pending: boolean;
};

export type ToWorker =
  | { type: "watch"; sub: number; documentId: string; fromHeads: Heads }
  | { type: "unwatch"; sub: number }
  | { type: "changes"; documentId: string; bytes: Uint8Array }
  | { type: "missing"; documentId: string }
  | { type: "drop"; documentId: string };

export type FromWorker = {
  type: "update";
  sub: number;
  update: HistoryGroupsUpdate;
};
