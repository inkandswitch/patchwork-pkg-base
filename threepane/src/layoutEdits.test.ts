import { describe, expect, it } from "vitest";
import { applyLayoutEdit, contextLane } from "./layoutEdits";
import type { ThreepaneConfigDoc } from "./types";

const config = (): ThreepaneConfigDoc => ({
  sidebar: { widgets: [] },
  doctitle: { tools: ["doc-openwith", ["sync-indicator", "automerge:x" as any]] },
  tray: [],
});

const tagged = [
  { id: "comments", name: "Comments" },
  { id: "drafts", name: "Drafts" },
];

describe("context tabs", () => {
  it("are the tagged components, untouched", () => {
    expect(contextLane(tagged, undefined).shown.map((t) => t.id)).toEqual([
      "comments",
      "drafts",
    ]);
  });

  it("can be removed, and come back by adding", () => {
    const doc = config();
    applyLayoutEdit(doc, { lane: "context", action: "remove", id: "drafts" });
    expect(contextLane(tagged, doc.context).shown.map((t) => t.id)).toEqual([
      "comments",
    ]);
    applyLayoutEdit(doc, { lane: "context", action: "add", id: "drafts" });
    expect(contextLane(tagged, doc.context).shown.map((t) => t.id)).toEqual([
      "comments",
      "drafts",
    ]);
  });

  it("can be hidden and shown", () => {
    const doc = config();
    applyLayoutEdit(doc, { lane: "context", action: "hide", id: "comments" });
    const lane = contextLane(tagged, doc.context);
    expect(lane.shown.map((t) => t.id)).toEqual(["drafts"]);
    expect(lane.hidden.map((t) => t.id)).toEqual(["comments"]);
    applyLayoutEdit(doc, { lane: "context", action: "show", id: "comments" });
    expect(contextLane(tagged, doc.context).hidden).toEqual([]);
  });

  it("take any component id by hand, after the tagged ones, once", () => {
    const doc = config();
    applyLayoutEdit(doc, { lane: "context", action: "add", id: "my-thing" });
    applyLayoutEdit(doc, { lane: "context", action: "add", id: "my-thing" });
    applyLayoutEdit(doc, { lane: "context", action: "add", id: "comments" });
    const lane = contextLane(tagged, doc.context, (id) => id.toUpperCase());
    expect(lane.shown).toEqual([
      { id: "comments", name: "Comments" },
      { id: "drafts", name: "Drafts" },
      { id: "my-thing", name: "MY-THING" },
    ]);
  });

  it("forget a hidden state when removed", () => {
    const doc = config();
    applyLayoutEdit(doc, { lane: "context", action: "hide", id: "my-thing" });
    applyLayoutEdit(doc, { lane: "context", action: "remove", id: "my-thing" });
    expect(doc.context?.hidden).toEqual([]);
  });
});

describe("doctitle tools", () => {
  it("are removed whichever form their slot is", () => {
    const doc = config();
    applyLayoutEdit(doc, { lane: "doctitle", action: "remove", id: "sync-indicator" });
    expect(doc.doctitle.tools).toEqual(["doc-openwith"]);
  });

  it("are added once, at the end, and a hidden one is shown", () => {
    const doc = config();
    applyLayoutEdit(doc, { lane: "doctitle", action: "hide", id: "doc-openwith" });
    applyLayoutEdit(doc, { lane: "doctitle", action: "add", id: "doc-openwith" });
    applyLayoutEdit(doc, { lane: "doctitle", action: "add", id: "doc-presence" });
    applyLayoutEdit(doc, { lane: "doctitle", action: "add", id: "sync-indicator" });
    expect(doc.doctitle.hidden).toEqual([]);
    expect(doc.doctitle.tools.map(String)).toEqual([
      "doc-openwith",
      "sync-indicator,automerge:x",
      "doc-presence",
    ]);
  });

  it("can be hidden and shown", () => {
    const doc = config();
    applyLayoutEdit(doc, { lane: "doctitle", action: "hide", id: "doc-openwith" });
    applyLayoutEdit(doc, { lane: "doctitle", action: "hide", id: "doc-openwith" });
    expect(doc.doctitle.hidden).toEqual(["doc-openwith"]);
    applyLayoutEdit(doc, { lane: "doctitle", action: "show", id: "doc-openwith" });
    expect(doc.doctitle.hidden).toEqual([]);
  });
});
