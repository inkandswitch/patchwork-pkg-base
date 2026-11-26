import { describe, expect, it } from "vitest";
import * as Automerge from "@automerge/automerge";
import {
  contextLane,
  editContext,
  editTitlebar,
  filterOptions,
  slotId,
  type ThreepaneConfigDoc,
} from "./lanes";

const tagged = [
  { id: "comments", name: "Comments" },
  { id: "history", name: "History" },
];

describe("contextLane", () => {
  it("is the tagged components when nothing's been edited", () => {
    expect(contextLane(tagged, undefined)).toEqual({
      shown: tagged,
      hidden: [],
    });
  });

  it("drops removed ones, puts added ones after, and splits out hidden", () => {
    const lane = contextLane(
      tagged,
      {
        removed: ["history"],
        added: ["outline", "comments"],
        hidden: ["comments"],
      },
      (id) => id.toUpperCase()
    );
    expect(lane.shown).toEqual([{ id: "outline", name: "OUTLINE" }]);
    expect(lane.hidden).toEqual([{ id: "comments", name: "Comments" }]);
  });
});

describe("editContext", () => {
  it("removing then adding brings a tab back, unhidden", () => {
    const doc: ThreepaneConfigDoc = {};
    editContext(doc, "hide", "history");
    editContext(doc, "remove", "history");
    expect(contextLane(tagged, doc.context).shown.map((i) => i.id)).toEqual([
      "comments",
    ]);
    editContext(doc, "add", "history");
    expect(contextLane(tagged, doc.context)).toEqual({
      shown: tagged,
      hidden: [],
    });
  });

  it("hide and show don't add anything twice", () => {
    const doc: ThreepaneConfigDoc = {};
    editContext(doc, "hide", "comments");
    editContext(doc, "hide", "comments");
    expect(doc.context?.hidden).toEqual(["comments"]);
    editContext(doc, "show", "comments");
    expect(doc.context?.hidden).toEqual([]);
  });
});

describe("editTitlebar", () => {
  it("adds once, removes every copy, and forgets a removed one was hidden", () => {
    const doc: ThreepaneConfigDoc = { doctitle: { tools: ["a"] } };
    editTitlebar(doc, { action: "add", id: " b " });
    editTitlebar(doc, { action: "add", id: "b" });
    editTitlebar(doc, { action: "hide", id: "b" });
    expect(doc.doctitle).toEqual({ tools: ["a", "b"], hidden: ["b"] });
    editTitlebar(doc, { action: "remove", id: "b" });
    expect(doc.doctitle).toEqual({ tools: ["a"], hidden: [] });
  });

  it("moves a pinned slot in a real doc and keeps it a pin", () => {
    let doc = Automerge.from<ThreepaneConfigDoc>({
      doctitle: { tools: ["a", ["pinned", "automerge:xyz"], "c"] },
    });
    doc = Automerge.change(doc, (d) =>
      editTitlebar(d, { action: "move", from: 1, to: 0 })
    );
    expect(doc.doctitle?.tools).toEqual([
      ["pinned", "automerge:xyz"],
      "a",
      "c",
    ]);
    doc = Automerge.change(doc, (d) =>
      editTitlebar(d, { action: "move", from: 0, to: 2 })
    );
    expect(doc.doctitle?.tools).toEqual([
      "a",
      "c",
      ["pinned", "automerge:xyz"],
    ]);
  });
});

describe("editTitlebar with immutable string slots", () => {
  it("removes, hides and moves a slot automerge hands back as an object", () => {
    let doc = Automerge.from<ThreepaneConfigDoc>({
      doctitle: {
        tools: [
          new Automerge.ImmutableString("open-with") as unknown as string,
          "branches",
        ],
      },
    });
    const first = doc.doctitle!.tools![0];
    expect(typeof first).not.toBe("string");
    expect(slotId(first)).toBe("open-with");

    doc = Automerge.change(doc, (d) =>
      editTitlebar(d, { action: "move", from: 0, to: 1 })
    );
    expect(doc.doctitle?.tools?.map(slotId)).toEqual(["branches", "open-with"]);

    doc = Automerge.change(doc, (d) =>
      editTitlebar(d, { action: "remove", id: "open-with" })
    );
    expect(doc.doctitle?.tools?.map(slotId)).toEqual(["branches"]);
  });
});

describe("filterOptions", () => {
  it("matches name or id, ignoring case", () => {
    const options = [
      { id: "doc-openwith", name: "Open With" },
      { id: "branches", name: "Branch picker" },
    ];
    expect(filterOptions(options, "OPEN").map((o) => o.id)).toEqual([
      "doc-openwith",
    ]);
    expect(filterOptions(options, "branches").map((o) => o.id)).toEqual([
      "branches",
    ]);
    expect(filterOptions(options, "  ")).toBe(options);
  });
});
