import * as Automerge from "@automerge/automerge/slim";

import { editCounter } from "./edit-counts.js";
import {
  addChange,
  advanceHeads,
  emptyDelta,
  sameHeads,
  sortedHeads,
  type ActorGroups,
  type GroupDelta,
} from "./grouping.js";
import type { HistoryStore } from "./store.js";
import type {
  FromWorker,
  Heads,
  HistoryGroup,
  HistoryGroupsUpdate,
  ToWorker,
} from "./types.js";

// Changes indexed between writes, so a first build streams in.
const BATCH_SIZE = 2000;
// A commit that lost to another tab reloads and goes again, this many times.
const MAX_ATTEMPTS = 3;

type Index = {
  documentId: string;
  fromHeads: Heads;
  toHeads: Heads;
  byActor: ActorGroups;
  subs: Set<number>;
  loaded: boolean;
};

type Entry = {
  doc: Automerge.Doc<unknown> | null;
  missing: boolean;
  indexes: Map<string, Index>;
  queue: Promise<void>;
};

// Where index moves are announced to (and heard from) other tabs' workers.
export type MovesChannel = {
  postMessage: (moved: Moved) => void;
  onmessage: ((event: MessageEvent<Moved>) => void) | null;
};

export type Moved = { documentId: string; fromHeads: Heads; toHeads: Heads };

// The worker's state and message handling. `store` must resolve only once
// Automerge's wasm is ready.
export function createIndexer(
  store: Promise<HistoryStore>,
  postMessage: (message: FromWorker) => void,
  channel: MovesChannel
): (message: ToWorker) => void {
  const entries = new Map<string, Entry>();
  const subs = new Map<number, Index>();
  channel.onmessage = (event) => moved(event.data);
  return receive;

  function receive(message: ToWorker): void {
    switch (message.type) {
      case "watch":
        return watch(message.sub, message.documentId, message.fromHeads);
      case "unwatch":
        return unwatch(message.sub);
      case "changes":
        return changes(message.documentId, message.bytes);
      case "missing":
        return missing(message.documentId);
      case "drop":
        entries.delete(message.documentId);
        return;
    }
  }

  function watch(sub: number, documentId: string, fromHeads: Heads): void {
    const entry = entryFor(documentId);
    const key = fromHeads.join(",");
    let index = entry.indexes.get(key);
    if (!index) {
      index = {
        documentId,
        fromHeads,
        toHeads: fromHeads,
        byActor: new Map(),
        subs: new Set(),
        loaded: false,
      };
      entry.indexes.set(key, index);
    }
    index.subs.add(sub);
    subs.set(sub, index);
    const watched = index;
    enqueue(entry, async () => {
      if (!watched.loaded) await reload(watched);
      post(sub, snapshot(entry, watched));
      await catchUp(entry, watched);
    });
  }

  function unwatch(sub: number): void {
    const index = subs.get(sub);
    subs.delete(sub);
    if (!index) return;
    index.subs.delete(sub);
    if (index.subs.size > 0) return;
    entries.get(index.documentId)?.indexes.delete(index.fromHeads.join(","));
  }

  function changes(documentId: string, bytes: Uint8Array): void {
    const entry = entryFor(documentId);
    enqueue(entry, async () => {
      entry.doc = Automerge.loadIncremental(entry.doc ?? Automerge.init(), bytes);
      entry.missing = false;
      for (const index of [...entry.indexes.values()]) {
        if (index.loaded) await catchUp(entry, index);
      }
    });
  }

  function missing(documentId: string): void {
    const entry = entryFor(documentId);
    enqueue(entry, async () => {
      entry.missing = true;
      for (const index of entry.indexes.values()) broadcast(index, settled(index));
    });
  }

  // Another tab's worker moved an index this one is watching.
  function moved({ documentId, fromHeads, toHeads }: Moved): void {
    const entry = entries.get(documentId);
    const index = entry?.indexes.get(fromHeads.join(","));
    if (!entry || !index || sameHeads(index.toHeads, toHeads)) return;
    enqueue(entry, async () => {
      if (sameHeads(index.toHeads, toHeads)) return;
      await reload(index);
      broadcast(index, snapshot(entry, index));
      await catchUp(entry, index);
    });
  }

  // Index the document's changes the index hasn't seen, writing as it goes.
  // Restarts from the stored index when another tab got there first.
  async function catchUp(entry: Entry, index: Index): Promise<void> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (await indexChanges(entry, index)) return;
      await reload(index);
      broadcast(index, snapshot(entry, index));
    }
  }

  async function indexChanges(entry: Entry, index: Index): Promise<boolean> {
    const doc = entry.doc;
    if (!doc) return true;
    // The index is ahead of this tab's copy of the document; it catches up
    // once the changes sync in.
    if (!Automerge.hasHeads(doc, index.toHeads)) {
      broadcast(index, settled(index));
      return true;
    }
    if (sameHeads(Automerge.getHeads(doc), index.toHeads)) {
      broadcast(index, settled(index));
      return true;
    }

    const changes = Automerge.getChangesSince(doc, index.toHeads);
    const count = editCounter(doc);
    const heads = new Set(index.toHeads);
    let delta = emptyDelta();
    for (let i = 0; i < changes.length; i++) {
      const change = Automerge.decodeChange(changes[i]);
      addChange(
        index.byActor,
        {
          actor: change.actor,
          hash: change.hash,
          deps: change.deps,
          time: change.time,
          ...count(change),
        },
        delta
      );
      advanceHeads(heads, change);
      const last = i === changes.length - 1;
      if (last || (i + 1) % BATCH_SIZE === 0) {
        if (!(await commit(index, delta, sortedHeads([...heads]), !last))) {
          return false;
        }
        delta = emptyDelta();
      }
    }
    return true;
  }

  async function commit(
    index: Index,
    delta: GroupDelta,
    toHeads: Heads,
    pending: boolean
  ): Promise<boolean> {
    const upsert = [...delta.upsert.values()];
    const remove = [...delta.remove.values()];
    const ok = await (await store).commit(
      { documentId: index.documentId, fromHeads: index.fromHeads, toHeads },
      index.toHeads,
      upsert,
      remove
    );
    if (!ok) return false;
    index.toHeads = toHeads;
    broadcast(index, { reset: false, upsert, remove, toHeads, pending });
    channel.postMessage({
      documentId: index.documentId,
      fromHeads: index.fromHeads,
      toHeads,
    } satisfies Moved);
    return true;
  }

  async function reload(index: Index): Promise<void> {
    const loaded = await (await store).load(index.documentId, index.fromHeads);
    index.toHeads = loaded?.toHeads ?? index.fromHeads;
    index.byActor = byActor(loaded?.groups ?? []);
    index.loaded = true;
  }

  function byActor(groups: HistoryGroup[]): ActorGroups {
    const out: ActorGroups = new Map();
    for (const group of groups) {
      let list = out.get(group.actor);
      if (!list) out.set(group.actor, (list = []));
      list.push(group);
    }
    for (const list of out.values()) list.sort((a, b) => a.startTime - b.startTime);
    return out;
  }

  function snapshot(entry: Entry, index: Index): HistoryGroupsUpdate {
    return {
      reset: true,
      upsert: [...index.byActor.values()].flat(),
      remove: [],
      toHeads: index.toHeads,
      pending: isPending(entry, index),
    };
  }

  function settled(index: Index): HistoryGroupsUpdate {
    return { reset: false, upsert: [], remove: [], toHeads: index.toHeads, pending: false };
  }

  function isPending(entry: Entry, index: Index): boolean {
    if (entry.missing) return false;
    if (!entry.doc) return true;
    return (
      Automerge.hasHeads(entry.doc, index.toHeads) &&
      !sameHeads(Automerge.getHeads(entry.doc), index.toHeads)
    );
  }

  function broadcast(index: Index, update: HistoryGroupsUpdate): void {
    for (const sub of index.subs) post(sub, update);
  }

  function post(sub: number, update: HistoryGroupsUpdate): void {
    postMessage({ type: "update", sub, update });
  }

  function entryFor(documentId: string): Entry {
    let entry = entries.get(documentId);
    if (!entry) {
      entry = { doc: null, missing: false, indexes: new Map(), queue: store.then(() => {}) };
      entries.set(documentId, entry);
    }
    return entry;
  }

  // One document's work runs in order: a watch's snapshot, then each batch of
  // changes.
  function enqueue(entry: Entry, task: () => Promise<void>): void {
    entry.queue = entry.queue.then(task).catch((err) => {
      console.error("[history] indexing failed:", err);
    });
  }
}
