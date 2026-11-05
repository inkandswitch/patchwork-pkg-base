import { describe, expect, it } from "vitest";
import * as Automerge from "@automerge/automerge";

import { editCounter } from "./edit-counts";
import {
  GROUP_GAP_MS,
  addChange,
  advanceHeads,
  emptyDelta,
  groupKey,
  sameHeads,
  type ActorGroups,
  type IndexedChange,
} from "./grouping";
import type { HistoryGroup } from "./types";

const GAP = GROUP_GAP_MS / 1000;
const T0 = 1_700_000_000;

describe("addChange", () => {
  it("keeps changes within the gap in one group", () => {
    const groups = index([
      change("a", 1, T0),
      change("a", 2, T0 + GAP),
      change("a", 3, T0 + 2 * GAP),
    ]);
    expect(groups.get("a")).toHaveLength(1);
    expect(groups.get("a")![0]).toMatchObject({
      startTime: T0,
      endTime: T0 + 2 * GAP,
      changeCount: 3,
      fromHeads: [],
      toHeads: ["a3"],
      additions: 3,
    });
  });

  it("splits on a pause longer than the gap", () => {
    const groups = index([change("a", 1, T0), change("a", 2, T0 + GAP + 1)]);
    expect(groups.get("a")!.map((g) => g.changeCount)).toEqual([1, 1]);
    expect(groups.get("a")![1].fromHeads).toEqual(["a1"]);
  });

  it("keeps actors apart however they interleave", () => {
    const groups = index([
      change("a", 1, T0),
      change("b", 1, T0 + 1, ["a1"]),
      change("a", 2, T0 + 2, ["b1"]),
    ]);
    expect(groups.get("a")![0].changeCount).toBe(2);
    expect(groups.get("b")![0].changeCount).toBe(1);
  });

  it("merges the groups a late change bridges", () => {
    const delta = emptyDelta();
    const groups: ActorGroups = new Map();
    addChange(groups, change("a", 1, T0), delta);
    addChange(groups, change("a", 2, T0 + 2 * GAP), delta);
    expect(groups.get("a")).toHaveLength(2);
    // a clock running behind stamps a later change between the two
    addChange(groups, change("a", 3, T0 + GAP), delta);
    expect(groups.get("a")).toHaveLength(1);
    expect(groups.get("a")![0]).toMatchObject({
      startTime: T0,
      endTime: T0 + 2 * GAP,
      changeCount: 3,
      toHeads: ["a2"],
    });
  });

  it("matches a fresh build however the changes are batched", () => {
    const changes = Array.from({ length: 40 }, (_, i) =>
      change(i % 3 === 0 ? "b" : "a", i + 1, T0 + i * 97)
    );
    const whole = index(changes);

    const stored = new Map<string, HistoryGroup>();
    const groups: ActorGroups = new Map();
    for (let start = 0; start < changes.length; start += 7) {
      const delta = emptyDelta();
      for (const c of changes.slice(start, start + 7)) addChange(groups, c, delta);
      for (const key of delta.remove.keys()) stored.delete(key);
      for (const [key, group] of delta.upsert) stored.set(key, { ...group });
    }

    const expected = [...whole.values()].flat().map((g) => [groupKey(g), g]);
    expect([...stored.entries()].sort()).toEqual(expected.sort());
  });
});

describe("advanceHeads", () => {
  it("ends at the document's heads", () => {
    let doc = Automerge.from({ text: "" });
    let other = Automerge.clone(doc);
    doc = Automerge.change(doc, (d) => Automerge.splice(d, ["text"], 0, 0, "x"));
    other = Automerge.change(other, (d) => Automerge.splice(d, ["text"], 0, 0, "y"));
    doc = Automerge.merge(doc, other);

    const heads = new Set<string>();
    for (const bytes of Automerge.getChangesSince(doc, [])) {
      advanceHeads(heads, Automerge.decodeChange(bytes));
    }
    expect(sameHeads([...heads], Automerge.getHeads(doc))).toBe(true);
  });
});

describe("editCounter", () => {
  it("counts content ops and skips @patchwork", () => {
    let doc = Automerge.from<{ "@patchwork": { type: string; n?: number }; text: string }>({
      "@patchwork": { type: "essay" },
      text: "",
    });
    const since = Automerge.getHeads(doc);
    doc = Automerge.change(doc, (d) => {
      Automerge.splice(d, ["text"], 0, 0, "hello");
      d["@patchwork"].n = 1;
    });
    doc = Automerge.change(doc, (d) => Automerge.splice(d, ["text"], 0, 2));

    const count = editCounter(doc);
    const counts = Automerge.getChangesSince(doc, since).map((bytes) =>
      count(Automerge.decodeChange(bytes))
    );
    expect(counts).toEqual([
      { additions: 5, deletions: 0 },
      { additions: 0, deletions: 2 },
    ]);
  });
});

function index(changes: IndexedChange[]): ActorGroups {
  const groups: ActorGroups = new Map();
  const delta = emptyDelta();
  for (const c of changes) addChange(groups, c, delta);
  return groups;
}

function change(actor: string, seq: number, time: number, deps?: string[]): IndexedChange {
  return {
    actor,
    hash: `${actor}${seq}`,
    deps: deps ?? (seq > 1 ? [`${actor}${seq - 1}`] : []),
    time,
    additions: 1,
    deletions: 0,
  };
}
