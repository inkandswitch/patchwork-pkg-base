import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo/slim";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";

const ROOT = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;
const PACKAGES = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;
const A = "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ" as AutomergeUrl;
const B = "automerge:3aNu5cqxaJ1vLywKRRX9kYEB8unS" as AutomergeUrl;

const { DocumentList } = await import("./document-list.tsx");

function fakeHandle(url: AutomergeUrl, doc: any) {
  return {
    url,
    documentId: url.slice("automerge:".length),
    doc: () => doc,
    change: vi.fn(),
    whenReady: async () => {},
    isReady: () => true,
    heads: () => [],
    on() {},
    off() {},
    addListener() {},
    removeListener() {},
  };
}
const docs: Record<string, any> = {
  [PACKAGES]: { title: "packages", docs: [] },
  [A]: { "@patchwork": { type: "md" } },
  [B]: { "@patchwork": { type: "md" } },
};
const repo = {
  find: async (url: AutomergeUrl) => fakeHandle(url, docs[url]),
  findWithProgress: (url: AutomergeUrl) => ({
    peek: () => ({ state: "ready", handle: fakeHandle(url, docs[url]) }),
    whenReady: async () => fakeHandle(url, docs[url]),
  }),
} as unknown as Repo;

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
});

describe("DocumentList: the packages folder", () => {
  it("sits last, below a line, and can't be dragged or dropped beside", async () => {
    const root = {
      title: "root",
      docs: [
        { name: "packages", type: "folder", url: PACKAGES },
        { name: "a", type: "md", url: A },
        { name: "b", type: "md", url: B },
      ],
    };
    const handle = fakeHandle(ROOT, root) as unknown as DocHandle<FolderDoc>;
    const container = document.createElement("div");
    document.body.append(container);
    dispose = render(
      () => (
        <DocumentList
          handle={handle}
          docs={root.docs as any}
          depth={0}
          repo={repo}
          open={() => {}}
          isSelected={() => false}
          element={container as any}
          rootFolderHandle={handle}
          filter=""
          clearFilter={() => {}}
          pinnedLast={PACKAGES}
        />
      ),
      container
    );
    await vi.waitFor(() =>
      expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(3)
    );
    const rows = [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    expect(rows.map((row) => row.getAttribute("data-doc-url"))).toEqual([A, B, PACKAGES]);
    expect(rows[2].getAttribute("draggable")).toBe("false");
    expect(rows[0].getAttribute("draggable")).toBe("true");
    // It keeps its real place in the folder doc, for rename and remove.
    expect(rows[2].getAttribute("data-dnd-index")).toBe("0");
    expect(rows[0].getAttribute("data-dnd-index")).toBe("1");
    expect(rows[2].closest(".document-list__item--pinned")).toBeTruthy();
  });
});
