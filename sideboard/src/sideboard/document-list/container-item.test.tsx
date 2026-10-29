import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { AutomergeUrl, Repo } from "@automerge/automerge-repo/slim";

const PKG = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;
const FILE = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;
const BOARD = "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ" as AutomergeUrl;
const PLAIN = "automerge:3aNu5cqxaJ1vLywKRRX9kYEB8unS" as AutomergeUrl;
const BROKEN = "automerge:4Nk2JnD9cGJ3xTaq9ADuXzX7dPHL" as AutomergeUrl;
const NESTED = "automerge:3VvPLAvjtd3gtkPjNHJ4w3rC6cTb" as AutomergeUrl;
const INNER = "automerge:2SxHu9PECxzCNn6mBV6uhw5yPxEW" as AutomergeUrl;
const FLAKY = "automerge:4AT7fHTvjgE6eCsMEPsiDAqpVrGw" as AutomergeUrl;
const DROPPED = "automerge:2Ldo5rBdVzfnDRCjgkRZrQ7pMUnW" as AutomergeUrl;
const CANVAS = "automerge:2rbVqNiLNVeZAHRxaj7yMZHBmBZV" as AutomergeUrl;

const typeOf = (doc: any) => doc?.["@patchwork"]?.type;

// A directory doc lists its keys.
const directory = {
  list: (node: any) =>
    Object.entries(node)
      .filter(([key]) => key !== "@patchwork")
      .map(([name, link]) => ({ name, link })),
};
// A package's provider: links, a sub-document, and editing.
const boardList = (node: any) => [
  ...node.links.map(({ name, url }: any) => ({ name, link: url })),
  ...(node.notes ? [{ name: "notes", sub: ["notes"] }] : []),
];
const board = {
  list: boardList,
  add: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
};
// A canvas's provider: its shapes, parts of it with no type of their own.
const canvas = {
  list: (node: any) => Object.keys(node.store).map((id) => ({ name: id, sub: ["store", id] })),
};
// One that offers no editing, and one that fails.
const plain = { list: boardList };
const broken = {
  list: () => {
    throw new Error("list");
  },
};

vi.mock("@inkandswitch/patchwork-filesystem", () => ({
  providerFor: (doc: any) => (typeOf(doc) === "directory" ? directory : undefined),
}));
// A folder, as far as the sidebar asks: its entries, and no editing here.
const folderish = {
  list: (node: any) => node.docs.map(({ name, url }: any) => ({ name, link: url })),
};
// The plugin providers by type; a test can swap one, as a hot reload does.
const byType: Record<string, unknown> = { directory, board, plain, broken, canvas };
const registryListeners = new Set<() => void>();
const changed = () => registryListeners.forEach((listener) => listener());
vi.mock("@inkandswitch/patchwork-plugins", () => ({
  pathProviderFor: async (doc: any) =>
    Array.isArray(doc?.docs) ? folderish : byType[typeOf(doc) as string],
  pathProviderTypes: () => new Set(["board", "plain", "broken", "canvas"]),
  getRegistry: () => ({
    on: (_event: string, listener: () => void) => {
      registryListeners.add(listener);
      return () => registryListeners.delete(listener);
    },
  }),
}));

const { ContainerItem } = await import("./container-item.tsx");
const { menuTarget } = await import("../state.ts");

function fakeHandle(url: AutomergeUrl, doc: any) {
  return {
    url,
    documentId: url.slice("automerge:".length),
    doc: () => doc,
    sub: (...segments: string[]) => ({ url: `${url}/${segments.join("/")}` }),
    whenReady: async () => {},
    isReady: () => true,
    heads: () => [],
    on() {},
    off() {},
    addListener() {},
    removeListener() {},
  };
}

const boardDoc = (type: string) => ({
  "@patchwork": { type },
  links: [{ name: "child", url: FILE }],
  notes: { "@patchwork": { type: "markdown" }, content: "n" },
});
const docs: Record<string, object> = {
  [PKG]: { "@patchwork": { type: "directory" }, "dist/index.js": FILE },
  [FILE]: { "@patchwork": { type: "file" }, content: "x" },
  [BOARD]: boardDoc("board"),
  [PLAIN]: boardDoc("plain"),
  [BROKEN]: boardDoc("broken"),
  // A board holding a folder, which takes no drops of its own.
  [NESTED]: { "@patchwork": { type: "board" }, links: [{ name: "inner", url: INNER }] },
  [INNER]: { title: "inner", docs: [{ name: "f", type: "file", url: FILE }] },
  // A board whose handle can't be found again (for a sub-document's url).
  [FLAKY]: boardDoc("board"),
  [CANVAS]: { "@patchwork": { type: "canvas" }, store: { "shape:a": { typeName: "shape" } } },
};
const handles = new Map<string, ReturnType<typeof fakeHandle>>();
const handleOf = (url: AutomergeUrl) => {
  if (!handles.has(url)) handles.set(url, fakeHandle(url, docs[url]));
  return handles.get(url)!;
};
/** What solid-automerge's useDocument asks of a Repo. */
const repo = {
  find: async (url: AutomergeUrl) => {
    if (url === FLAKY) throw new Error("unavailable");
    return handleOf(url);
  },
  findWithProgress: (url: AutomergeUrl) => ({
    peek: () => ({ state: "ready", handle: handleOf(url) }),
    whenReady: async () => handleOf(url),
  }),
} as unknown as Repo;

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function mount(url: AutomergeUrl, type: string, name: string) {
  const container = document.createElement("div");
  document.body.append(container);
  const opened: any[] = [];
  dispose = render(
    () => (
      <ContainerItem
        url={url}
        name={name}
        type={type}
        id="row"
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
        <span>{name}</span>
      </ContainerItem>
    ),
    container
  );
  const rows = () => container.querySelectorAll<HTMLElement>('[role="treeitem"]');
  const row = (label: string) => [...rows()].find((r) => r.textContent?.includes(label))!;
  const expand = async (count: number) => {
    (container.querySelector(".document-list-folder__toggle") as HTMLElement).click();
    await vi.waitFor(() => expect(rows()).toHaveLength(count));
  };
  const menuOn = (label: string) => {
    row(label).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 1 }));
    return menuTarget()!;
  };
  return { container, opened, rows, row, expand, menuOn };
}

describe("ContainerItem", () => {
  it("opens up to its children, which open at their path and can't be edited", async () => {
    const { opened, rows, expand, menuOn } = mount(PKG, "directory", "foo");
    expect(rows()).toHaveLength(1);
    await expand(2);
    const child = rows()[1];
    expect(child.textContent).toContain("dist/index.js");

    child.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(opened.at(-1)).toMatchObject({
      url: FILE,
      path: "acct/packages/foo/dist/index.js",
    });

    const target = menuOn("dist/index.js");
    expect(target.readOnly).toBe(true);
    expect(target.canRename).toBeFalsy();
    expect(target.canRemove).toBeFalsy();
  });

  it("lists a package provider's links and sub-documents", async () => {
    const { opened, row, expand } = mount(BOARD, "board", "b");
    await expand(3);
    row("notes").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(opened.at(-1)).toMatchObject({
      url: `${BOARD}/notes`,
      type: "markdown",
      path: "acct/packages/b/notes",
    });
  });

  it("opens a sub-document with no type of its own with its container's type", async () => {
    const { opened, row, expand } = mount(CANVAS, "canvas", "c");
    await expand(2);
    row("shape:a").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(opened.at(-1)).toMatchObject({
      url: `${CANVAS}/store/shape:a`,
      type: "canvas",
      path: "acct/packages/c/shape:a",
    });
  });

  it("renames and removes through the provider, when it offers them", async () => {
    const { container, expand, menuOn } = mount(BOARD, "board", "b");
    await expand(3);
    const target = menuOn("child");
    expect(target.canRename).toBe(true);
    expect(target.canRemove).toBe(true);

    target.remove();
    await vi.waitFor(() =>
      expect(board.remove).toHaveBeenCalledWith(handleOf(BOARD), docs[BOARD], "child")
    );

    target.startRenaming();
    const input = await vi.waitFor(() => {
      const found = container.querySelector<HTMLInputElement>("input.document-list-item__name");
      expect(found).toBeTruthy();
      return found!;
    });
    input.value = "renamed";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(board.rename).toHaveBeenCalledWith(handleOf(BOARD), docs[BOARD], "child", "renamed")
    );
  });

  it("leaves children read-only when the provider offers no editing", async () => {
    const { expand, menuOn } = mount(PLAIN, "plain", "p");
    await expand(3);
    const target = menuOn("child");
    expect(target.readOnly).toBe(true);
    expect(target.canRename).toBeFalsy();
    expect(target.canRemove).toBeFalsy();
  });

  let subDrop = false;
  it("adds a document dropped among its children, when the provider offers it", async () => {
    const drop = async (url: AutomergeUrl, type: string) => {
      const { container, expand } = mount(url, type, "x");
      await expand(3);
      const group = container.querySelector<HTMLElement>(".document-list-folder__contents")!;
      const dropped = subDrop ? `${DROPPED}/notes` : DROPPED;
      const payload = JSON.stringify({ source: "s", items: [{ url: dropped, name: "dropped" }] });
      const dataTransfer = {
        types: ["text/x-patchwork-dnd"],
        files: [],
        dropEffect: "none",
        getData: (type: string) => (type === "text/x-patchwork-dnd" ? payload : ""),
      };
      for (const type of ["dragover", "drop"]) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
        group.dispatchEvent(event);
      }
      dispose?.();
      document.body.innerHTML = "";
    };

    await drop(BOARD, "board");
    await vi.waitFor(() =>
      expect(board.add).toHaveBeenCalledWith(handleOf(BOARD), docs[BOARD], {
        name: "dropped",
        link: DROPPED,
      })
    );
    board.add.mockClear();
    // A sub-document isn't a document to link to: walks wouldn't follow it.
    subDrop = true;
    await drop(BOARD, "board");
    subDrop = false;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(board.add).not.toHaveBeenCalled();
    await drop(PLAIN, "plain");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(board.add).not.toHaveBeenCalled();
  });

  it("doesn't hand a drop meant for a nested folder to the board around it", async () => {
    const { container, row, rows, expand } = mount(NESTED, "board", "n");
    await expand(2);
    (row("inner").querySelector(".document-list-folder__toggle") as HTMLElement).click();
    await vi.waitFor(() => expect(rows()).toHaveLength(3));
    const groups = container.querySelectorAll<HTMLElement>(".document-list-folder__contents");
    const inner = groups[groups.length - 1];
    const payload = JSON.stringify({ source: "s", items: [{ url: DROPPED, name: "dropped" }] });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { types: ["text/x-patchwork-dnd"], files: [], getData: () => payload },
    });
    inner.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(board.add).not.toHaveBeenCalled();
  });

  it("asks again for a provider when path-provider plugins change", async () => {
    const { rows, expand } = mount(BOARD, "board", "b");
    await expand(3);
    byType.board = { list: () => [{ name: "only", link: FILE }] };
    try {
      changed();
      await vi.waitFor(() => expect(rows()).toHaveLength(2));
    } finally {
      byType.board = board;
    }
  });

  it("hides a sub-document whose url can't be had, without breaking the list", async () => {
    const { rows, row, expand } = mount(FLAKY, "board", "f");
    await expand(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rows()).toHaveLength(2);
    expect(row("child")).toBeTruthy();
  });

  it("shows no children when the provider fails", async () => {
    const { container, rows } = mount(BROKEN, "broken", "x");
    (container.querySelector(".document-list-folder__toggle") as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rows()).toHaveLength(1);
  });
});
