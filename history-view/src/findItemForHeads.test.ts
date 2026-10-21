import { describe, expect, it } from "vitest";
import { findItemForHeads, type HistoryItem } from "./types";

const item = (latestHash: string, subs: string[] = []): HistoryItem => ({
  id: latestHash,
  count: 1,
  latestHash,
  authors: [],
  subItems: subs.length ? subs.map((h) => item(h)) : undefined,
});

describe("findItemForHeads", () => {
  const items = [item("c3"), item("b2", ["b2", "b1"]), item("a1")];

  it("finds the item that ends at the heads", () => {
    expect(findItemForHeads(items, ["c3"])?.id).toBe("c3");
    expect(findItemForHeads(items, ["a1"])?.id).toBe("a1");
  });

  it("finds an item by one of its per-author sub-items", () => {
    expect(findItemForHeads(items, ["b1"])?.id).toBe("b2");
  });

  it("takes any one of several concurrent heads", () => {
    expect(findItemForHeads(items, ["zz", "a1"])?.id).toBe("a1");
  });

  it("is null for heads it doesn't know, or none", () => {
    expect(findItemForHeads(items, ["nope"])).toBeNull();
    expect(findItemForHeads(items, [])).toBeNull();
  });
});
