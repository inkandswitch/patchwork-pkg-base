import { describe, expect, it } from "vitest";
import type { Doc } from "@automerge/automerge/slim";

import {
  collectCommentTimes,
  INACTIVITY_GAP_MS,
  splitIntoGroups,
} from "./change-group-cache";

// Newest-first rows in Unix seconds; splitIntoGroups only reads `time`.
const rows = (...timesNewestFirst: number[]) =>
  timesNewestFirst.map((time) => ({ time }));

const times = (groups: { time: number }[][]) =>
  groups.map((group) => group.map((row) => row.time));

const GAP_S = INACTIVITY_GAP_MS / 1000;

describe("splitIntoGroups", () => {
  it("keeps a continuous burst together and splits at an inactivity lull", () => {
    const input = rows(3000 + GAP_S + 1, 3000, 2990, 2980);
    expect(times(splitIntoGroups(input))).toEqual([
      [3000 + GAP_S + 1],
      [3000, 2990, 2980],
    ]);
  });

  it("splits a burst where a comment was made", () => {
    const input = rows(1200, 1100, 1000);
    expect(times(splitIntoGroups(input, [1_050_000]))).toEqual([
      [1200, 1100],
      [1000],
    ]);
  });

  it("does not split on a comment newer than every change", () => {
    const input = rows(1100, 1000);
    expect(times(splitIntoGroups(input, [2_000_000]))).toEqual([
      [1100, 1000],
    ]);
  });

  it("does not split on a comment older than every change", () => {
    const input = rows(1100, 1000);
    expect(times(splitIntoGroups(input, [500_000]))).toEqual([[1100, 1000]]);
  });

  it("groups a change made in the comment's own second with the older side", () => {
    // The comment's own write is stamped in the same second as the comment,
    // so the boundary is half-open: rows at or before the comment go below.
    const input = rows(1100, 1000, 990);
    expect(times(splitIntoGroups(input, [1_000_500]))).toEqual([
      [1100],
      [1000, 990],
    ]);
  });

  it("does not split between changes in the same second", () => {
    const input = rows(1000, 1000, 1000);
    expect(times(splitIntoGroups(input, [1_000_500]))).toEqual([
      [1000, 1000, 1000],
    ]);
  });

  it("splits a boundary once however many comments fall in it", () => {
    const input = rows(1200, 1000);
    expect(
      times(splitIntoGroups(input, [1_150_000, 1_100_000, 1_050_000]))
    ).toEqual([[1200], [1000]]);
  });

  it("splits several boundaries for several comments", () => {
    const input = rows(1400, 1300, 1200, 1100);
    expect(times(splitIntoGroups(input, [1_350_000, 1_150_000]))).toEqual([
      [1400],
      [1300, 1200],
      [1100],
    ]);
  });
});

describe("collectCommentTimes", () => {
  it("flattens every comment timestamp across docs, newest first", () => {
    const docA = {
      "@comments": {
        threads: [
          { comments: [{ timestamp: 1000 }, { timestamp: 3000 }] },
          { comments: [{ timestamp: 2000 }] },
        ],
      },
    };
    const docB = { title: "no comments" };
    const docC = {
      "@comments": { threads: [{ comments: [{ timestamp: 4000 }, {}] }] },
    };
    expect(
      collectCommentTimes([docA, docB, docC] as unknown as Doc<unknown>[])
    ).toEqual([4000, 3000, 2000, 1000]);
  });
});
