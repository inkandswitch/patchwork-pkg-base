import { describe, expect, it } from "vitest";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo/slim";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import {
  expandedFoldersFromIndex,
  isMounted,
  markMounted,
  watchFolder,
} from "./auto-expand.ts";

// The index is module state, so every test namespaces its urls.
let n = 0;
function urls(...names: string[]) {
  const prefix = `automerge:t${n++}-`;
  return names.map((name) => (prefix + name) as AutomergeUrl);
}

function fakeFolder(url: AutomergeUrl, childUrls: AutomergeUrl[]) {
  let doc = { docs: childUrls.map((url) => ({ url, name: url, type: "x" })) };
  const listeners: (() => void)[] = [];
  const handle = {
    url,
    doc: () => doc,
    on: (_event: string, fn: () => void) => listeners.push(fn),
  } as unknown as DocHandle<FolderDoc>;
  function setChildren(next: AutomergeUrl[]) {
    doc = { docs: next.map((url) => ({ url, name: url, type: "x" })) };
    listeners.forEach((fn) => fn());
  }
  return { handle, setChildren };
}

describe("expandedFoldersFromIndex", () => {
  it("traces a nested doc up to the root", () => {
    const [root, a, b, leaf] = urls("root", "a", "b", "leaf");
    watchFolder(fakeFolder(root, [a]).handle);
    watchFolder(fakeFolder(a, [b]).handle);
    watchFolder(fakeFolder(b, [leaf]).handle);
    expect(expandedFoldersFromIndex(root, [leaf])).toEqual(
      new Set([root, a, b])
    );
  });

  it("returns null when a selection can't reach the root", () => {
    const [root, a, orphanParent, leaf] = urls("root", "a", "op", "leaf");
    watchFolder(fakeFolder(root, [a]).handle);
    watchFolder(fakeFolder(orphanParent, [leaf]).handle);
    expect(expandedFoldersFromIndex(root, [leaf])).toBeNull();
  });

  it("follows a folder's changes when a doc moves", () => {
    const [root, a, b, leaf] = urls("root", "a", "b", "leaf");
    watchFolder(fakeFolder(root, [a, b]).handle);
    const folderA = fakeFolder(a, [leaf]);
    const folderB = fakeFolder(b, []);
    watchFolder(folderA.handle);
    watchFolder(folderB.handle);
    folderA.setChildren([]);
    folderB.setChildren([leaf]);
    expect(expandedFoldersFromIndex(root, [leaf])).toEqual(new Set([root, b]));
  });

  it("collects every path to the root and survives cycles", () => {
    const [root, a, b, leaf] = urls("root", "a", "b", "leaf");
    watchFolder(fakeFolder(root, [a, b]).handle);
    watchFolder(fakeFolder(a, [b, leaf]).handle);
    watchFolder(fakeFolder(b, [a, leaf]).handle);
    expect(expandedFoldersFromIndex(root, [leaf])).toEqual(
      new Set([root, a, b])
    );
  });
});

describe("markMounted", () => {
  it("refcounts rows per panel", () => {
    const [url] = urls("doc");
    const panel = {};
    const other = {};
    const unmountOne = markMounted(panel, url);
    const unmountTwo = markMounted(panel, url);
    expect(isMounted(panel, url)).toBe(true);
    expect(isMounted(other, url)).toBe(false);
    unmountOne();
    expect(isMounted(panel, url)).toBe(true);
    unmountTwo();
    expect(isMounted(panel, url)).toBe(false);
  });
});
