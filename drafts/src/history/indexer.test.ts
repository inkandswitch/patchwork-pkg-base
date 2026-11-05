import { describe, expect, it, vi } from "vitest";
import * as Automerge from "@automerge/automerge";

import { groupKey, sameHeads } from "./grouping";
import { createIndexer, type Moved, type MovesChannel } from "./indexer";
import type { HistoryIndex, HistoryStore } from "./store";
import type { FromWorker, Heads, HistoryGroup } from "./types";

const T0 = 1_700_000_000;

describe("createIndexer", () => {
  it("indexes a document and follows its changes", async () => {
    const tab = createTab(memoryStore());
    let doc = edits(created(), T0, 3);
    tab.receive({ type: "watch", sub: 1, documentId: "d", fromHeads: [] });
    tab.receive({ type: "changes", documentId: "d", bytes: Automerge.save(doc) });
    await vi.waitFor(() => expect(tab.view(1).pending).toBe(false));
    expect(tab.view(1).groups.map((g) => g.changeCount)).toEqual([4]);

    const before = Automerge.getHeads(doc);
    doc = edits(doc, T0 + 3600, 2);
    tab.receive({ type: "changes", documentId: "d", bytes: Automerge.saveSince(doc, before) });
    await vi.waitFor(() =>
      expect(sameHeads(tab.view(1).toHeads, Automerge.getHeads(doc))).toBe(true)
    );
    expect(tab.view(1).groups.map((g) => g.changeCount).sort()).toEqual([2, 4]);
  });

  it("indexes only the history after a fork point", async () => {
    const tab = createTab(memoryStore());
    let doc = edits(created(), T0, 5);
    const fork = Automerge.getHeads(doc);
    doc = edits(doc, T0 + 10, 2);
    tab.receive({ type: "watch", sub: 1, documentId: "d", fromHeads: [...fork].sort() });
    tab.receive({ type: "changes", documentId: "d", bytes: Automerge.save(doc) });
    await vi.waitFor(() => expect(tab.view(1).pending).toBe(false));
    expect(tab.view(1).groups.map((g) => g.changeCount)).toEqual([2]);
  });

  it("serves another tab from the stored index", async () => {
    const store = memoryStore();
    const doc = edits(created(), T0, 3);
    const first = createTab(store);
    first.receive({ type: "watch", sub: 1, documentId: "d", fromHeads: [] });
    first.receive({ type: "changes", documentId: "d", bytes: Automerge.save(doc) });
    await vi.waitFor(() => expect(first.view(1).pending).toBe(false));

    const second = createTab(store);
    second.receive({ type: "watch", sub: 1, documentId: "d", fromHeads: [] });
    await vi.waitFor(() => expect(second.view(1).groups).toHaveLength(1));
    second.receive({ type: "changes", documentId: "d", bytes: Automerge.save(doc) });
    await vi.waitFor(() => expect(second.view(1).pending).toBe(false));
    expect(store.commits).toBe(1);
  });
});

function created(): Automerge.Doc<{ text: string }> {
  return Automerge.change(Automerge.init<{ text: string }>(), { time: T0 - 1 }, (d) => {
    d.text = "";
  });
}

function edits<T extends { text: string }>(doc: Automerge.Doc<T>, time: number, n: number) {
  for (let i = 0; i < n; i++) {
    doc = Automerge.change(doc, { time: time + i }, (d) =>
      Automerge.splice(d, ["text"], 0, 0, "x")
    );
  }
  return doc;
}

// One tab's worker, with what each subscription currently holds.
function createTab(store: HistoryStore) {
  const views = new Map<number, { groups: Map<string, HistoryGroup>; toHeads: Heads; pending: boolean }>();
  const channel: MovesChannel = { postMessage: (_: Moved) => {}, onmessage: null };
  const receive = createIndexer(
    Promise.resolve(store),
    ({ sub, update }: FromWorker) => {
      let view = views.get(sub);
      if (!view) views.set(sub, (view = { groups: new Map(), toHeads: [], pending: true }));
      if (update.reset) view.groups.clear();
      for (const key of update.remove) view.groups.delete(groupKey(key));
      for (const group of update.upsert) view.groups.set(groupKey(group), group);
      view.toHeads = update.toHeads;
      view.pending = update.pending;
    },
    channel
  );
  return {
    receive,
    view(sub: number) {
      const view = views.get(sub) ?? { groups: new Map(), toHeads: [], pending: true };
      return { ...view, groups: [...view.groups.values()] };
    },
  };
}

function memoryStore(): HistoryStore & { commits: number } {
  const indexes = new Map<string, HistoryIndex>();
  const groups = new Map<string, Map<string, HistoryGroup>>();
  const id = (documentId: string, fromHeads: Heads) => `${documentId}|${fromHeads.join(",")}`;
  const store = {
    commits: 0,
    async load(documentId: string, fromHeads: Heads) {
      const index = indexes.get(id(documentId, fromHeads));
      if (!index) return null;
      return {
        toHeads: index.toHeads,
        groups: [...(groups.get(id(documentId, fromHeads))?.values() ?? [])].map((g) => ({ ...g })),
      };
    },
    async commit(index: HistoryIndex, baseHeads: Heads, upsert: HistoryGroup[], remove: { actor: string; fromHeads: Heads }[]) {
      const key = id(index.documentId, index.fromHeads);
      if (!sameHeads(indexes.get(key)?.toHeads ?? index.fromHeads, baseHeads)) return false;
      let stored = groups.get(key);
      if (!stored) groups.set(key, (stored = new Map()));
      for (const k of remove) stored.delete(groupKey(k));
      for (const g of upsert) stored.set(groupKey(g), { ...g });
      indexes.set(key, { ...index });
      store.commits++;
      return true;
    },
  };
  return store;
}
