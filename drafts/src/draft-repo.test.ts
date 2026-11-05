import { beforeAll, describe, expect, it } from "vitest";
import {
  Repo,
  initSubduction,
  type DocHandle,
} from "@automerge/automerge-repo";

import { DraftRepo } from "./draft-repo";
import type { DraftDoc } from "./draft-types";

type Note = { "@patchwork": { type: string }; text: string; items: string[] };

function setup() {
  const base = new Repo({});
  const original = base.create<Note>({
    "@patchwork": { type: "note" },
    text: "main",
    items: [],
  });
  const draft = base.create<DraftDoc>({
    "@patchwork": { type: "draft" },
    parent: original.url,
    drafts: [],
    clones: {},
  });
  const repo = new DraftRepo(base);
  return { base, original, draft, repo };
}

function changes(handle: DocHandle<unknown>) {
  const seen: { scopeReplaced?: boolean }[] = [];
  handle.on("change", (payload) => seen.push(payload as never));
  return seen;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(() => initSubduction());

describe("DraftRepo", () => {
  it("reads the original on main", async () => {
    const { original, repo } = setup();
    const handle = await repo.find<Note>(original.url);
    expect(handle.url).toBe(original.url);
    expect(handle.doc()?.text).toBe("main");
  });

  it("forks a doc on its first write in a draft and writes to the fork", async () => {
    const { original, draft, repo } = setup();
    repo.checkout({ draft, at: null });
    const handle = await repo.find<Note>(original.url);
    const seen = changes(handle as DocHandle<unknown>);

    expect(draft.doc()?.clones).toEqual({});
    handle.change((d) => {
      d.text = "draft";
    });

    const entry = draft.doc()?.clones[original.url];
    expect(entry?.cloneUrl).toBeDefined();
    expect(entry?.cloneUrl).not.toBe(original.url);
    expect(handle.url).toBe(original.url);
    expect(handle.doc()?.text).toBe("draft");
    expect(original.doc()?.text).toBe("main");
    expect(seen.some((p) => p.scopeReplaced)).toBe(false);
  });

  it("swaps live handles back to the original when main is checked out", async () => {
    const { original, draft, repo } = setup();
    repo.checkout({ draft, at: null });
    const handle = await repo.find<Note>(original.url);
    handle.change((d) => {
      d.text = "draft";
    });
    const seen = changes(handle as DocHandle<unknown>);

    repo.checkout({ draft: null, at: null });
    await tick();

    expect(handle.doc()?.text).toBe("main");
    expect(seen.some((p) => p.scopeReplaced)).toBe(true);
  });

  it("pins a doc to its checkpoint heads", async () => {
    const { original, repo } = setup();
    const before = original.heads();
    original.change((d) => {
      d.text = "later";
    });
    const handle = await repo.find<Note>(original.url);
    expect(handle.doc()?.text).toBe("later");

    repo.checkout({ draft: null, at: { [original.url]: { to: before } } });
    await tick();
    expect(handle.doc()?.text).toBe("main");
  });

  it("keeps sub-handles in the presented url space and forks on their writes", async () => {
    const { original, draft, repo } = setup();
    repo.checkout({ draft, at: null });
    const handle = await repo.find<Note>(original.url);
    const items = handle.sub("items") as DocHandle<string[]>;
    expect(items.documentId).toBe(original.documentId);

    items.change((list) => {
      list.push("one");
    });

    expect(draft.doc()?.clones[original.url]).toBeDefined();
    expect(handle.doc()?.items).toEqual(["one"]);
    expect(original.doc()?.items).toEqual([]);
  });

  it("follows a clone someone else recorded in the draft", async () => {
    const { base, original, draft, repo } = setup();
    repo.checkout({ draft, at: null });
    const handle = await repo.find<Note>(original.url);

    const clone = base.clone(original);
    clone.change((d) => {
      d.text = "theirs";
    });
    draft.change((d) => {
      d.clones[original.url] = { cloneUrl: clone.url, clonedAt: [] as never };
    });
    await tick();

    expect(handle.doc()?.text).toBe("theirs");
  });

  it("passes skipped docs straight through", async () => {
    const { base, draft, repo } = setup();
    const account = base.create({ "@patchwork": { type: "account" } });
    repo.checkout({ draft, at: null });
    const handle = await repo.find(account.url);
    expect(handle).toBe(account);
  });
});
