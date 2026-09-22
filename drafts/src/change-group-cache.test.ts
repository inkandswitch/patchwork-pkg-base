import { describe, expect, it } from "vitest";
import * as Automerge from "@automerge/automerge";

import { computeEditCounts, editCountsSince } from "./change-group-cache";

type Fixture = {
  "@patchwork": {
    type: string;
    nested?: { a: number };
    copies?: string[];
    mainDraftUrl?: string;
  };
  text: string;
  list: { n: number }[];
  title?: string;
};

function history(): Automerge.Doc<Fixture> {
  let doc = Automerge.from<Fixture>({
    "@patchwork": { type: "essay", nested: { a: 1 }, copies: [] },
    text: "",
    list: [],
  });
  for (let i = 0; i < 60; i++) {
    doc = Automerge.change(doc, { time: 1_700_000_000 + i * 30 }, (d) => {
      if (i % 7 === 0 && d.text.length > 5) {
        Automerge.splice(d, ["text"], 0, 3);
      } else {
        Automerge.splice(d, ["text"], d.text.length, 0, `word${i} `);
      }
      if (i % 10 === 0) d.list.push({ n: i });
      if (i % 15 === 0) d["@patchwork"].nested!.a = i;
      if (i === 20) d["@patchwork"].mainDraftUrl = "automerge:abc";
      if (i === 25) d["@patchwork"].copies!.push("automerge:copy");
      if (i === 30) d.title = "Hello";
      if (i === 40) delete d.title;
    });
  }
  let other = Automerge.clone(doc);
  other = Automerge.change(other, { time: 1_700_009_000 }, (d) => {
    Automerge.splice(d, ["text"], 0, 0, "Y");
  });
  doc = Automerge.change(doc, { time: 1_700_009_001 }, (d) => {
    Automerge.splice(d, ["text"], 0, 0, "Z");
  });
  return Automerge.merge(doc, other);
}

async function expectSameAsDiff(
  doc: Automerge.Doc<Fixture>,
  since: Automerge.Heads
) {
  const counts = await editCountsSince(doc, since);
  const metas = Automerge.getChangesMetaSince(doc, since);
  expect(counts).not.toBeNull();
  expect(counts!.size).toBe(metas.length);
  for (const meta of metas) {
    expect(counts!.get(meta.hash), meta.hash).toEqual(
      computeEditCounts(doc, meta.hash, meta.deps)
    );
  }
}

describe("editCountsSince", () => {
  it("matches the per-change diff counts over the whole history", async () => {
    await expectSameAsDiff(history(), []);
  });

  it("matches the diff counts on an incremental tail, including edits inside @patchwork containers created earlier", async () => {
    const doc = history();
    const metas = Automerge.getChangesMetaSince(doc, []);
    await expectSameAsDiff(doc, [metas[10].hash]);
    await expectSameAsDiff(doc, [metas[24].hash]);
  });

  it("counts a metadata-only change as zero edits", async () => {
    let doc = history();
    doc = Automerge.change(doc, (d) => {
      d["@patchwork"].copies!.push("automerge:another");
      d["@patchwork"].nested!.a = 99;
      d["@patchwork"].type = "note";
    });
    const heads = Automerge.getHeads(doc);
    const counts = await editCountsSince(doc, [
      Automerge.getChangesMetaSince(doc, []).at(-2)!.hash,
    ]);
    expect(counts!.get(heads[0])).toEqual({ additions: 0, deletions: 0 });
  });

  it("counts a mark once, like the diff does", async () => {
    let doc = history();
    doc = Automerge.change(doc, (d) => {
      Automerge.mark(
        d,
        ["text"],
        { start: 0, end: 4, expand: "none" },
        "bold",
        true
      );
    });
    const [head] = Automerge.getHeads(doc);
    const meta = Automerge.getChangesMetaSince(doc, []).find(
      (m) => m.hash === head
    )!;
    const counts = await editCountsSince(doc, meta.deps);
    expect(counts!.get(head)).toEqual(computeEditCounts(doc, head, meta.deps));
  });

  it("resolves null when the tick aborts", async () => {
    expect(await editCountsSince(history(), [], async () => false)).toBeNull();
  });
});
