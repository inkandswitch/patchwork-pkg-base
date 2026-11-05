import { beforeAll, describe, expect, it, vi } from "vitest";
// Initializes the wasm the overlay's slim automerge shares.
import "@automerge/automerge";
import {
  Repo,
  initSubduction,
  type DocHandle,
} from "@automerge/automerge-repo";

import type { DraftDoc } from "./draft-types";

vi.mock("@inkandswitch/patchwork-plugins", () => import("./test-registry"));

const { DraftRepo } = await import("./draft-repo");

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
// Long enough for the overlay's document tree to finish walking.
const walked = () => new Promise((resolve) => setTimeout(resolve, 100));

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
    expect(handle.isReadOnly()).toBe(true);
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

  it("writes straight through to docs outside the draft's tree", async () => {
    const { base, original, draft, repo } = setup();
    const folder = base.create({
      "@patchwork": { type: "folder" },
      docs: [{ url: original.url, type: "note" }],
    });
    const account = base.create<{ name: string }>({ name: "me" });
    repo.setRoot(folder.url);
    repo.checkout({ draft, at: null });
    await walked();

    const handle = await repo.find<{ name: string }>(account.url);
    handle.change((d) => {
      d.name = "renamed";
    });
    const note = await repo.find<Note>(original.url);
    note.change((d) => {
      d.text = "draft";
    });

    expect(account.doc()?.name).toBe("renamed");
    expect(Object.keys(draft.doc()?.clones ?? {})).toEqual([original.url]);
    expect(original.doc()?.text).toBe("main");
  });

  it("reads a recorded fork point until the first write, then clones there", async () => {
    const { original, draft, repo } = setup();
    const clonedAt = original.heads();
    original.change((d) => {
      d.text = "main later";
    });
    draft.change((d) => {
      d.clones[original.url] = { clonedAt };
    });
    repo.checkout({ draft, at: null });
    const handle = await repo.find<Note>(original.url);
    expect(handle.doc()?.text).toBe("main");
    expect(handle.isReadOnly()).toBe(false);

    handle.change((d) => {
      d.items.push("draft");
    });

    const entry = draft.doc()?.clones[original.url];
    expect(entry?.cloneUrl).toBeDefined();
    expect(entry?.clonedAt).toEqual(clonedAt);
    expect(handle.doc()).toMatchObject({ text: "main", items: ["draft"] });
    expect(original.doc()).toMatchObject({ text: "main later", items: [] });
  });

  it("forks off the recorded source", async () => {
    const { base, original, draft, repo } = setup();
    const parentClone = base.clone(original);
    parentClone.change((d) => {
      d.text = "parent";
    });
    draft.change((d) => {
      d.clones[original.url] = {
        source: parentClone.url,
        clonedAt: parentClone.heads(),
      };
    });
    repo.checkout({ draft, at: null });
    const handle = await repo.find<Note>(original.url);
    expect(handle.doc()?.text).toBe("parent");

    handle.change((d) => {
      d.items.push("child");
    });

    expect(handle.doc()).toMatchObject({ text: "parent", items: ["child"] });
    expect(parentClone.doc()?.items).toEqual([]);
  });

  it("records a doc created on the draft as its own clone", async () => {
    const { draft, repo } = setup();
    repo.checkout({ draft, at: null });
    const created = repo.create<Note>({
      "@patchwork": { type: "note" },
      text: "new",
      items: [],
    });
    const handle = await repo.find<Note>(created.url);

    handle.change((d) => {
      d.text = "edited";
    });

    expect(draft.doc()?.clones[created.url]?.cloneUrl).toBe(created.url);
    expect(created.doc()?.text).toBe("edited");
  });
});
