import { describe, expect, it, vi } from "vitest";
import {
  generateAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";

vi.mock("@inkandswitch/patchwork-plugins", () => import("./test-registry"));

const { walkDocTree, watchDocTree } = await import("./doc-tree");

type Link = { url: AutomergeUrl; type?: string };

function fakeRepo() {
  const docs = new Map<AutomergeUrl, unknown>();
  const listeners = new Map<AutomergeUrl, Set<() => void>>();
  const finds: AutomergeUrl[] = [];
  const repo = {
    find: async (url: AutomergeUrl) => {
      finds.push(url);
      if (!docs.has(url)) throw new Error(`unavailable: ${url}`);
      return {
        url,
        doc: () => docs.get(url),
        on: (_: string, fn: () => void) => listenersOf(url).add(fn),
        off: (_: string, fn: () => void) => listenersOf(url).delete(fn),
      } as unknown as DocHandle<unknown>;
    },
  } as unknown as Repo;
  const listenersOf = (url: AutomergeUrl) => {
    let set = listeners.get(url);
    if (!set) listeners.set(url, (set = new Set()));
    return set;
  };
  const add = (doc: unknown, url = generateAutomergeUrl()): AutomergeUrl => {
    docs.set(url, doc);
    return url;
  };
  const folder = (links: Link[], url?: AutomergeUrl) =>
    add({ "@patchwork": { type: "folder" }, docs: links }, url);
  const leaf = () => add({ "@patchwork": { type: "essay" } });
  const replace = (url: AutomergeUrl, doc: unknown) => {
    docs.set(url, doc);
    for (const fn of listenersOf(url)) fn();
  };
  return { repo, add, folder, leaf, replace, finds };
}

describe("walkDocTree", () => {
  it("lists nested docs depth-first in entry order", async () => {
    const { repo, folder, leaf } = fakeRepo();
    const a = leaf();
    const b = leaf();
    const c = leaf();
    const inner = folder([{ url: b, type: "essay" }]);
    const root = folder([
      { url: a, type: "essay" },
      { url: inner, type: "folder" },
      { url: c, type: "essay" },
    ]);

    const { urls } = await walkDocTree(repo, root);

    expect(urls).toEqual([root, a, inner, b, c]);
  });

  it("doesn't load children whose datatype has no children plugin", async () => {
    const { repo, folder, leaf, finds } = fakeRepo();
    const a = leaf();
    const root = folder([{ url: a, type: "essay" }]);

    await walkDocTree(repo, root);

    expect(finds).toEqual([root]);
  });

  it("loads children of unknown datatype to ask them", async () => {
    const { repo, folder, leaf } = fakeRepo();
    const deep = leaf();
    const untyped = folder([{ url: deep, type: "essay" }]);
    const root = folder([{ url: untyped }]);

    const { urls } = await walkDocTree(repo, root);

    expect(urls).toEqual([root, untyped, deep]);
  });

  it("lists each doc once and survives cycles", async () => {
    const { repo, folder, leaf } = fakeRepo();
    const shared = leaf();
    const rootUrl = generateAutomergeUrl();
    const inner = folder([
      { url: shared, type: "essay" },
      { url: rootUrl, type: "folder" },
    ]);
    folder(
      [
        { url: inner, type: "folder" },
        { url: shared, type: "essay" },
      ],
      rootUrl
    );

    const { urls } = await walkDocTree(repo, rootUrl);

    expect(urls).toEqual([rootUrl, inner, shared]);
  });

  it("keeps docs that fail to load as leaves", async () => {
    const { repo, folder } = fakeRepo();
    const missing = generateAutomergeUrl();
    const root = folder([{ url: missing, type: "folder" }]);

    const { urls } = await walkDocTree(repo, root);

    expect(urls).toEqual([root, missing]);
  });

  it("reads children through readUrl", async () => {
    const { repo, folder, leaf } = fakeRepo();
    const original = leaf();
    const cloned = leaf();
    const root = folder([{ url: original, type: "essay" }]);
    const clone = folder([{ url: cloned, type: "essay" }]);

    const { urls } = await walkDocTree(repo, root, (url) =>
      url === root ? clone : url
    );

    expect(urls).toEqual([root, cloned]);
  });
});

describe("watchDocTree", () => {
  it("walks again when a doc in the tree changes", async () => {
    const { repo, folder, leaf, replace } = fakeRepo();
    const a = leaf();
    const b = leaf();
    const inner = folder([{ url: a, type: "essay" }]);
    const root = folder([{ url: inner, type: "folder" }]);
    const onChange = vi.fn();

    const tree = watchDocTree(repo, root, { onChange });
    await tree.settled();
    expect(tree.urls()).toEqual([root, inner, a]);
    expect(tree.isSettled()).toBe(true);

    replace(inner, {
      "@patchwork": { type: "folder" },
      docs: [
        { url: a, type: "essay" },
        { url: b, type: "essay" },
      ],
    });
    await vi.waitFor(() => expect(tree.has(b)).toBe(true));
    expect(onChange).toHaveBeenCalledTimes(2);
    tree.dispose();
  });
});
