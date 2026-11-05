import { beforeAll, describe, expect, it, vi } from "vitest";
import "@automerge/automerge";
import {
  Repo,
  decodeHeads,
  initSubduction,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";

import type { DraftDoc } from "./draft-types";
import { cloneAt } from "./draft-clones";

vi.mock("@inkandswitch/patchwork-plugins", () => import("./test-registry"));

const { forkPoints, mergeDraft } = await import("./draft-forks");

type Note = { text: string };

beforeAll(() => initSubduction());

function setup() {
  const repo = new Repo({});
  const a = repo.create<Note>({ text: "a" });
  const b = repo.create<Note>({ text: "b" });
  const folder = repo.create({
    "@patchwork": { type: "folder" },
    docs: [
      { url: a.url, type: "note" },
      { url: b.url, type: "note" },
    ],
  });
  const mainDraft = draftDoc(repo, folder.url, { isMain: true });
  return { repo, a, b, folder, mainDraft };
}

function draftDoc(
  repo: Repo,
  parent: AutomergeUrl,
  fields: Partial<DraftDoc> = {}
): DocHandle<DraftDoc> {
  return repo.create<DraftDoc>({
    "@patchwork": { type: "draft" },
    parent,
    drafts: [],
    clones: {},
    ...fields,
  });
}

describe("forkPoints", () => {
  it("records every doc of main at its current heads", async () => {
    const { repo, a, b, folder } = setup();

    const clones = await forkPoints(repo, folder.url, null, null);

    expect(clones).toEqual({
      [folder.url]: { clonedAt: folder.heads() },
      [a.url]: { clonedAt: a.heads() },
      [b.url]: { clonedAt: b.heads() },
    });
  });

  it("branches off a parent draft's clones and keeps its unforked points", async () => {
    const { repo, a, b, folder } = setup();
    const aClone = repo.clone(a);
    aClone.change((d) => {
      d.text = "a on parent";
    });
    const bAt = b.heads();
    b.change((d) => {
      d.text = "b later";
    });
    const parent = draftDoc(repo, a.url, {
      clones: {
        [a.url]: { cloneUrl: aClone.url, clonedAt: a.heads() },
        [b.url]: { clonedAt: bAt },
      },
    });

    const clones = await forkPoints(repo, folder.url, parent.url, null);

    expect(clones).toEqual({
      [folder.url]: { clonedAt: folder.heads() },
      [a.url]: { source: aClone.url, clonedAt: aClone.heads() },
      [b.url]: { clonedAt: bAt },
    });
  });

  it("records each doc as of a version", async () => {
    const { repo, a, folder } = setup();
    a.change((d) => {
      d.text = "a1";
    }, { time: 100 });
    const at = a.heads();
    a.change((d) => {
      d.text = "a2";
    }, { time: 200 });

    const clones = await forkPoints(repo, folder.url, null, {
      docUrl: a.url,
      hash: decodeHeads(at)[0],
      time: 100,
    });

    expect(clones[a.url]).toEqual({ clonedAt: at });
  });
});

describe("mergeDraft", () => {
  it("merges clones into the originals off main", async () => {
    const { repo, a, b, mainDraft } = setup();
    const aClone = repo.clone(a);
    aClone.change((d) => {
      d.text = "merged";
    });
    const draft = draftDoc(repo, mainDraft.url, {
      clones: {
        [a.url]: { cloneUrl: aClone.url, clonedAt: a.heads() },
        [b.url]: { clonedAt: b.heads() },
      },
    });

    await mergeDraft(repo, draft);

    expect(a.doc()?.text).toBe("merged");
    expect(b.doc()?.text).toBe("b");
    expect(draft.doc()?.mergedAt).toBeDefined();
    expect(draft.doc()?.clones[b.url]?.mergedAt).toBeUndefined();
  });

  it("clones a parent's unforked doc at its fork point before merging into it", async () => {
    const { repo, a, mainDraft } = setup();
    const parentAt = a.heads();
    a.change((d) => {
      d.text = "main moved on";
    });
    const parent = draftDoc(repo, mainDraft.url, {
      clones: { [a.url]: { clonedAt: parentAt } },
    });
    const childClone = cloneAt(repo, a as DocHandle<unknown>, parentAt) as DocHandle<Note>;
    const childStart = childClone.heads();
    const child = draftDoc(repo, parent.url, {
      clones: { [a.url]: { cloneUrl: childClone.url, clonedAt: childStart } },
    });
    childClone.change((d) => {
      d.text = "child";
    });

    await mergeDraft(repo, child);

    const parentCloneUrl = parent.doc()?.clones[a.url]?.cloneUrl;
    expect(parentCloneUrl).toBeDefined();
    const parentClone = await repo.find<Note>(parentCloneUrl!);
    expect(parentClone.doc()?.text).toBe("child");
    expect(a.doc()?.text).toBe("main moved on");
  });
});
