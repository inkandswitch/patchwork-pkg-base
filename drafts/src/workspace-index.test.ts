import { describe, expect, it, vi } from "vitest";
import {
  generateAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";

vi.mock("@inkandswitch/patchwork-plugins", () => import("./test-registry"));

const { createWorkspaceIndex } = await import("./workspace-index");

type Link = { url: AutomergeUrl; type: string; name: string };

// Just enough of a Repo for the index: `find` resolving handles whose `doc()`
// is fixed.
function fakeRepo() {
  const docs = new Map<AutomergeUrl, unknown>();
  const repo = {
    find: async (url: AutomergeUrl) => {
      if (!docs.has(url)) throw new Error(`unavailable: ${url}`);
      return {
        url,
        doc: () => docs.get(url),
        on: () => {},
        off: () => {},
      } as unknown as DocHandle<unknown>;
    },
  } as unknown as Repo;
  const add = (doc: unknown): AutomergeUrl => {
    const url = generateAutomergeUrl();
    docs.set(url, doc);
    return url;
  };
  const folder = (links: Link[], workspace = false) =>
    add({
      "@patchwork": workspace
        ? { type: "folder", workspace: true }
        : { type: "folder" },
      docs: links,
    });
  const leaf = () => add({ "@patchwork": { type: "essay" } });
  return { repo, folder, leaf };
}

const asFolder = (url: AutomergeUrl): Link => ({
  url,
  type: "folder",
  name: "f",
});
const asLeaf = (url: AutomergeUrl): Link => ({ url, type: "essay", name: "e" });

async function settledIndex(
  repo: Repo,
  root: AutomergeUrl,
  readUrlFor: (
    root: AutomergeUrl,
    url: AutomergeUrl
  ) => Promise<AutomergeUrl> = async (_root, url) => url
) {
  const index = createWorkspaceIndex(repo, {
    rootFolderUrl: () => root,
    readUrlFor,
    onChange: () => {},
  });
  index.refresh();
  await index.settled();
  return index;
}

describe("createWorkspaceIndex", () => {
  it("puts everything beneath a workspace folder in that workspace", async () => {
    const { repo, folder, leaf } = fakeRepo();
    const inner = leaf();
    const sub = folder([asLeaf(inner)]);
    const top = leaf();
    const ws = folder([asLeaf(top), asFolder(sub)], true);
    const outside = leaf();
    const root = folder([asFolder(ws), asLeaf(outside)]);

    const index = await settledIndex(repo, root);

    expect(index.rootOf(ws)).toBe(ws);
    expect(index.rootOf(top)).toBe(ws);
    expect(index.rootOf(sub)).toBe(ws);
    expect(index.rootOf(inner)).toBe(ws);
    expect(index.rootOf(outside)).toBeUndefined();
    expect(index.isPlainContainer(root)).toBe(true);
    expect(index.isPlainContainer(ws)).toBe(false);
    index.dispose();
  });

  it("lets the topmost workspace win over one nested inside it", async () => {
    const { repo, folder, leaf } = fakeRepo();
    const doc = leaf();
    const nested = folder([asLeaf(doc)], true);
    const outer = folder([asFolder(nested)], true);
    const root = folder([asFolder(outer)]);

    const index = await settledIndex(repo, root);

    expect(index.rootOf(nested)).toBe(outer);
    expect(index.rootOf(doc)).toBe(outer);
    index.dispose();
  });

  it("uses the first path for a doc linked twice", async () => {
    const { repo, folder, leaf } = fakeRepo();
    const shared = leaf();
    const plain = folder([asLeaf(shared)]);
    const ws = folder([asLeaf(shared)], true);

    const plainFirst = await settledIndex(
      repo,
      folder([asFolder(plain), asFolder(ws)])
    );
    expect(plainFirst.rootOf(shared)).toBeUndefined();
    plainFirst.dispose();

    const wsFirst = await settledIndex(
      repo,
      folder([asFolder(ws), asFolder(plain)])
    );
    expect(wsFirst.rootOf(shared)).toBe(ws);
    wsFirst.dispose();
  });

  it("reads a workspace's folders through its checked-out draft", async () => {
    const { repo, folder, leaf } = fakeRepo();
    const onMain = leaf();
    const onDraft = leaf();
    const ws = folder([asLeaf(onMain)], true);
    const wsClone = folder([asLeaf(onMain), asLeaf(onDraft)], true);
    const root = folder([asFolder(ws)]);

    const index = await settledIndex(repo, root, async (_root, url) =>
      url === ws ? wsClone : url
    );

    expect(index.rootOf(onDraft)).toBe(ws);
    index.dispose();
  });
});
