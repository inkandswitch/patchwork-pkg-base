import { describe, expect, it } from "vitest";
import * as A from "@automerge/automerge";
import { encodeHeads, type AutomergeUrl } from "@automerge/automerge-repo/slim";

import {
  attributedHashes,
  frontierHashes,
  partitionRows,
  type ChangeMetaLike,
  type MergedDraftSpec,
} from "./merge-attribution";

// Scenarios ported from patchwork-24's compareBranches.test.ts, minus the
// "main merged into branch" case: drafts never merges parent into child, so
// the walk needs no main-side subtraction.

type TestDoc = { content: string };

function decodedChanges(doc: A.Doc<TestDoc>): ChangeMetaLike[] {
  return A.getAllChanges(doc).map((change) => A.decodeChange(change));
}

describe("attributedHashes", () => {
  it("attributes a single draft change, with nothing concurrent on main", () => {
    //  x main
    //   \
    //    x draft
    const baseDoc = A.change(A.init<TestDoc>(), (d) => {
      d.content = "hello";
    });
    const baseHeads = A.getHeads(baseDoc);
    const draftDoc = A.change(A.clone(baseDoc), (d) => {
      d.content = "world";
    });
    const mergeHeads = A.getHeads(draftDoc);

    const finalDoc = A.merge(A.clone(baseDoc), A.clone(draftDoc));
    const result = attributedHashes(
      decodedChanges(finalDoc),
      mergeHeads,
      baseHeads
    );

    expect(result).toEqual(new Set(mergeHeads));
  });

  it("attributes two draft changes, with nothing concurrent on main", () => {
    //  x main
    //   \
    //    x
    //    |
    //    x draft
    const baseDoc = A.change(A.init<TestDoc>(), (d) => {
      d.content = "hello";
    });
    const baseHeads = A.getHeads(baseDoc);

    const draftHashes: string[] = [];
    let draftDoc = A.change(A.clone(baseDoc), (d) => {
      d.content = "world";
    });
    draftHashes.push(A.getHeads(draftDoc)[0]);
    draftDoc = A.change(draftDoc, (d) => {
      d.content = "yo";
    });
    draftHashes.push(A.getHeads(draftDoc)[0]);
    const mergeHeads = A.getHeads(draftDoc);

    const finalDoc = A.merge(A.clone(baseDoc), A.clone(draftDoc));
    const result = attributedHashes(
      decodedChanges(finalDoc),
      mergeHeads,
      baseHeads
    );

    expect(result).toEqual(new Set(draftHashes));
  });

  it("does not attribute a change concurrent on main", () => {
    //     x
    //     |\
    //main x  x
    //        |
    //        x draft
    const baseDoc = A.change(A.init<TestDoc>(), (d) => {
      d.content = "hello";
    });
    const baseHeads = A.getHeads(baseDoc);

    const draftHashes: string[] = [];
    let draftDoc = A.change(A.clone(baseDoc), (d) => {
      d.content = "world";
    });
    draftHashes.push(A.getHeads(draftDoc)[0]);
    draftDoc = A.change(draftDoc, (d) => {
      d.content = "yo";
    });
    draftHashes.push(A.getHeads(draftDoc)[0]);
    const mergeHeads = A.getHeads(draftDoc);

    const mainDoc = A.change(A.clone(baseDoc), (d) => {
      d.content = "bar";
    });

    const finalDoc = A.merge(A.clone(mainDoc), A.clone(draftDoc));
    const result = attributedHashes(
      decodedChanges(finalDoc),
      mergeHeads,
      baseHeads
    );

    expect(result).toEqual(new Set(draftHashes));
  });

  it("does not attribute changes made on main after the merge", () => {
    //  x main
    //  |\
    //  | x draft
    //  |/
    //  x
    //  |
    //  x main again
    const baseDoc = A.change(A.init<TestDoc>(), (d) => {
      d.content = "hello";
    });
    const baseHeads = A.getHeads(baseDoc);
    const draftDoc = A.change(A.clone(baseDoc), (d) => {
      d.content = "world";
    });
    const mergeHeads = A.getHeads(draftDoc);

    const mergedDoc = A.merge(A.clone(baseDoc), A.clone(draftDoc));
    const finalDoc = A.change(A.clone(mergedDoc), (d) => {
      d.content = "bar";
    });
    const result = attributedHashes(
      decodedChanges(finalDoc),
      mergeHeads,
      baseHeads
    );

    expect(result).toEqual(new Set(mergeHeads));
  });

  it("stops at every head of a multi-head fork frontier", () => {
    //  x
    //  |\
    //  x  x   <- fork point: two concurrent heads
    //   \/
    //    x draft
    const rootDoc = A.change(A.init<TestDoc>(), (d) => {
      d.content = "hello";
    });
    const left = A.change(A.clone(rootDoc), (d) => {
      d.content = "left";
    });
    const right = A.change(A.clone(rootDoc), (d) => {
      d.content = "right";
    });
    const baseDoc = A.merge(A.clone(left), A.clone(right));
    const baseHeads = A.getHeads(baseDoc);
    expect(baseHeads.length).toBe(2);

    const draftDoc = A.change(A.clone(baseDoc), (d) => {
      d.content = "draft";
    });
    const mergeHeads = A.getHeads(draftDoc);

    const finalDoc = A.merge(A.clone(baseDoc), A.clone(draftDoc));
    const result = attributedHashes(
      decodedChanges(finalDoc),
      mergeHeads,
      baseHeads
    );

    expect(result).toEqual(new Set(mergeHeads));
  });

  it("keeps draining the walk after dequeuing a stop head", () => {
    // A merge frontier can contain a base head itself. patchwork-24's walk
    // aborted outright on the first stop head it dequeued; ours must only
    // end that branch of the walk.
    const metas: ChangeMetaLike[] = [
      { hash: "b", deps: [] },
      { hash: "c", deps: ["b"] },
    ];
    expect(attributedHashes(metas, ["c", "b"], ["b"])).toEqual(new Set(["c"]));
    expect(attributedHashes(metas, ["b", "c"], ["b"])).toEqual(new Set(["c"]));
  });

  it("treats hashes missing from the window as stops", () => {
    // The grouper's pre-creation-time filter can drop rows from the window;
    // the walk must end there rather than throw.
    const metas: ChangeMetaLike[] = [{ hash: "c", deps: ["missing"] }];
    expect(attributedHashes(metas, ["c"], [])).toEqual(new Set(["c"]));
  });
});

describe("partitionRows", () => {
  const memberUrl = "automerge:test-member" as AutomergeUrl;

  it("pulls a merged draft's changes out of a time-interleaved row list", () => {
    // Draft and parent edit concurrently with interleaved timestamps; the
    // partition must split by DAG reachability, not by time.
    const baseDoc = A.change(
      A.init<TestDoc>(),
      { time: 100 },
      (d) => {
        d.content = "hello";
      }
    );
    const baseHash = A.getHeads(baseDoc)[0];
    const clonedAt = encodeHeads(A.getHeads(baseDoc));

    const draftHashes: string[] = [];
    let draftDoc = A.change(A.clone(baseDoc), { time: 200 }, (d) => {
      d.content = "draft one";
    });
    draftHashes.push(A.getHeads(draftDoc)[0]);
    draftDoc = A.change(draftDoc, { time: 400 }, (d) => {
      d.content = "draft two";
    });
    draftHashes.push(A.getHeads(draftDoc)[0]);
    const mergedFrom = encodeHeads(A.getHeads(draftDoc));

    const parentHashes: string[] = [];
    let parentDoc = A.change(A.clone(baseDoc), { time: 300 }, (d) => {
      d.content = "parent one";
    });
    parentHashes.push(A.getHeads(parentDoc)[0]);
    parentDoc = A.change(parentDoc, { time: 500 }, (d) => {
      d.content = "parent two";
    });
    parentHashes.push(A.getHeads(parentDoc)[0]);

    const mergedDoc = A.merge(A.clone(parentDoc), A.clone(draftDoc));

    // The grouper's newest-first row shape: hash/deps/time plus memberUrl.
    const rows = A.getAllChanges(mergedDoc)
      .map((change) => A.decodeChange(change))
      .map((meta) => ({
        memberUrl,
        hash: meta.hash,
        deps: meta.deps,
        time: meta.time,
      }))
      .sort((a, b) => b.time - a.time);

    const draftUrl = "automerge:test-draft" as AutomergeUrl;
    const spec: MergedDraftSpec = {
      url: draftUrl,
      name: "Test draft",
      members: {
        [memberUrl]: { baseHeads: clonedAt, mergeHeads: mergedFrom },
      },
    };

    const { merged, rest } = partitionRows(rows, [spec]);

    expect(merged.get(draftUrl)?.map((r) => r.hash)).toEqual(
      // Input order (newest-first by time) is preserved.
      [draftHashes[1], draftHashes[0]]
    );
    expect(rest.map((r) => r.hash)).toEqual([
      parentHashes[1],
      parentHashes[0],
      baseHash,
    ]);
  });

  it("passes everything through when there are no merged drafts", () => {
    const rows = [
      { memberUrl, hash: "a", deps: [] },
      { memberUrl, hash: "b", deps: ["a"] },
    ];
    const { merged, rest } = partitionRows(rows, []);
    expect(merged.size).toBe(0);
    expect(rest).toEqual(rows);
  });
});

describe("frontierHashes", () => {
  it("reduces a linear chain to its newest change", () => {
    const rows: ChangeMetaLike[] = [
      { hash: "c", deps: ["b"] },
      { hash: "b", deps: ["a"] },
      { hash: "a", deps: [] },
    ];
    expect(frontierHashes(rows)).toEqual(["c"]);
  });

  it("keeps concurrent branches as a multi-head frontier", () => {
    // A merged draft's rows and the parent's regular rows share a base but
    // not each other — the state below a boundary containing both is the
    // union, so both heads must survive.
    const rows: ChangeMetaLike[] = [
      { hash: "draft2", deps: ["draft1"] },
      { hash: "draft1", deps: ["base"] },
      { hash: "main1", deps: ["base"] },
      { hash: "base", deps: [] },
    ];
    expect(new Set(frontierHashes(rows))).toEqual(
      new Set(["draft2", "main1"])
    );
  });

  it("ignores deps pointing outside the set", () => {
    // Rows whose deps reach into older history (below the fork point or the
    // creation cutoff) are frontier candidates like any other.
    const rows: ChangeMetaLike[] = [{ hash: "a", deps: ["outside"] }];
    expect(frontierHashes(rows)).toEqual(["a"]);
  });

  it("verifies against Automerge's own heads for a concurrent merge", () => {
    type TestDoc = { content: string };
    const baseDoc = A.change(A.init<TestDoc>(), (d) => {
      d.content = "hello";
    });
    const left = A.change(A.clone(baseDoc), (d) => {
      d.content = "left";
    });
    const right = A.change(A.clone(baseDoc), (d) => {
      d.content = "right";
    });
    const mergedDoc = A.merge(A.clone(left), A.clone(right));
    const rows = A.getAllChanges(mergedDoc).map((change) =>
      A.decodeChange(change)
    );
    expect(new Set(frontierHashes(rows))).toEqual(
      new Set(A.getHeads(mergedDoc))
    );
  });
});
