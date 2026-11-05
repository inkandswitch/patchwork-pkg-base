import { describe, expect, it } from "vitest";
import {
  encodeHeads,
  type AutomergeUrl,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";

import {
  TIMELINE_GAP_MS,
  combineHistories,
  type MemberHistory,
} from "./timeline";
import type { HistoryGroup as Group } from "./history/types";

type HistoryGroup = Group<UrlHeads>;

const GAP = TIMELINE_GAP_MS / 1000;
const T0 = 1_700_000_000;
const DOC_A = "automerge:docA" as AutomergeUrl;
const DOC_B = "automerge:docB" as AutomergeUrl;

describe("combineHistories", () => {
  it("joins groups from different members and actors that overlap", () => {
    const rows = combineHistories([
      member(DOC_A, [group("alice", T0, T0 + 60, "aa"), group("bob", T0 + 30, T0 + 90, "bb")]),
      member(DOC_B, [group("alice", T0 + 100, T0 + 120, "cc")]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      startTime: T0,
      endTime: T0 + 120,
      newestMemberUrl: DOC_B,
      newestHash: "cc",
      actors: ["alice", "bob"],
      changeCount: 3,
      additions: 3,
    });
  });

  it("splits on a pause longer than the gap, newest first", () => {
    const rows = combineHistories([
      member(DOC_A, [group("alice", T0, T0, "aa"), group("alice", T0 + GAP + 1, T0 + GAP + 1, "bb")]),
    ]);
    expect(rows.map((r) => r.newestHash)).toEqual(["bb", "aa"]);
  });

  it("stitches at a coarser gap", () => {
    const histories = [
      member(DOC_A, [group("alice", T0, T0, "aa"), group("alice", T0 + 2 * GAP, T0 + 2 * GAP, "bb")]),
    ];
    expect(combineHistories(histories)).toHaveLength(2);
    expect(combineHistories(histories, { gapMs: 3 * TIMELINE_GAP_MS })).toHaveLength(1);
  });

  it("drops rows that end before the root was created", () => {
    const rows = combineHistories(
      [member(DOC_A, [group("alice", T0, T0, "aa"), group("alice", T0 + 2 * GAP, T0 + 2 * GAP, "bb")])],
      { createdAt: T0 + GAP }
    );
    expect(rows.map((r) => r.newestHash)).toEqual(["bb"]);
  });

  it("keeps rows disjoint, so a row's span holds exactly its changes", () => {
    const histories = [
      member(DOC_A, [group("alice", T0, T0 + 10, "a1"), group("alice", T0 + 1000, T0 + 1010, "a2")]),
      member(DOC_B, [group("bob", T0 + 200, T0 + 250, "b1"), group("bob", T0 + 3000, T0 + 3000, "b2")]),
    ];
    const rows = combineHistories(histories);
    for (let i = 1; i < rows.length; i++) {
      expect((rows[i - 1].startTime - rows[i].endTime) * 1000).toBeGreaterThan(TIMELINE_GAP_MS);
    }
    const total = histories.flatMap((h) => h.groups).reduce((n, g) => n + g.changeCount, 0);
    expect(rows.reduce((n, r) => n + r.changeCount, 0)).toBe(total);
  });
});

function member(memberUrl: AutomergeUrl, groups: HistoryGroup[]): MemberHistory {
  return { memberUrl, groups, pending: false };
}

function group(actor: string, startTime: number, endTime: number, hash: string): HistoryGroup {
  return {
    actor,
    fromHeads: encodeHeads([]),
    toHeads: encodeHeads([hash]),
    startTime,
    endTime,
    additions: 1,
    deletions: 0,
    changeCount: 1,
  };
}
