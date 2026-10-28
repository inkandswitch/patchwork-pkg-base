import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { AutomergeUrl, Repo } from "@automerge/automerge-repo/slim";

const PKG = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;
const FILE = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;

// The host's providers: a directory doc lists its keys.
vi.mock("@inkandswitch/patchwork-filesystem", () => ({
  providerFor: (doc: any) =>
    doc?.["@patchwork"]?.type === "directory"
      ? {
          list: (node: any) =>
            Object.entries(node)
              .filter(([key]) => key !== "@patchwork")
              .map(([name, link]) => ({ name, link })),
        }
      : undefined,
}));

const { ContainerItem } = await import("./container-item.tsx");
const { menuTarget } = await import("../state.ts");

function fakeHandle(url: AutomergeUrl, doc: object) {
  return {
    url,
    documentId: url.slice("automerge:".length),
    doc: () => doc,
    whenReady: async () => {},
    isReady: () => true,
    heads: () => [],
    on() {},
    off() {},
    addListener() {},
    removeListener() {},
  };
}

const docs: Record<string, object> = {
  [PKG]: { "@patchwork": { type: "directory" }, "dist/index.js": FILE },
  [FILE]: { "@patchwork": { type: "file" }, content: "x" },
};
/** What solid-automerge's useDocument asks of a Repo. */
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

describe("ContainerItem", () => {
  it("opens up to its children, which open at their path and can't be edited", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const opened: unknown[] = [];
    dispose = render(
      () => (
        <ContainerItem
          url={PKG}
          name="foo"
          type="directory"
          id="pkg"
          depth={1}
          names={["packages"]}
          startRenaming={() => {}}
          remove={() => {}}
          repo={repo}
          element={container as any}
          rootFolderHandle={{} as any}
          open={(detail) => opened.push(detail)}
          isSelected={() => false}
          livePathOf={(names) => ["acct", ...names].join("/")}
        >
          <span>foo</span>
        </ContainerItem>
      ),
      container
    );
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(1);

    (container.querySelector(".document-list-folder__toggle") as HTMLElement).click();
    await vi.waitFor(() =>
      expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(2)
    );
    const child = container.querySelectorAll<HTMLElement>('[role="treeitem"]')[1];
    expect(child.textContent).toContain("dist/index.js");

    child.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(opened.at(-1)).toMatchObject({
      url: FILE,
      path: "acct/packages/foo/dist/index.js",
    });

    child.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 1 }));
    expect(menuTarget()?.readOnly).toBe(true);
  });
});
