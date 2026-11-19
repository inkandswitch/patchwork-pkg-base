import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESENCE, announce, folderTree, foldersHolding } from "./presence.js";

type Fake = { url: string; doc: () => unknown; isReady: () => boolean; broadcast: ReturnType<typeof vi.fn> };
const folder = (url: string, docs: string[]): Fake => ({
  url,
  doc: () => ({
    title: url,
    docs: docs.map((child) => ({ url: child, type: child.includes("folder") ? "folder" : "x" })),
  }),
  isReady: () => true,
  broadcast: vi.fn(),
});
const leaf = (url: string): Fake => ({ url, doc: () => ({ text: "" }), isReady: () => true, broadcast: vi.fn() });

const DOC = "automerge:doc";
const who = { contact: "automerge:me", name: "chee", colour: "", avatar: "" };

describe("foldersHolding", () => {
  it("finds the open folders a doc's in, through other open folders, and nothing else", () => {
    const inner = folder("automerge:inner", [DOC]);
    const outer = folder("automerge:outer", ["automerge:inner"]);
    const elsewhere = folder("automerge:elsewhere", ["automerge:other"]);
    const found = foldersHolding([inner, outer, elsewhere, leaf(DOC)] as never, `${DOC}#heads`);
    expect(found.map((handle) => handle.url).sort()).toEqual(["automerge:inner", "automerge:outer"]);
  });

  it("goes round a loop once", () => {
    const a = folder("automerge:a", [DOC, "automerge:b"]);
    const b = folder("automerge:b", ["automerge:a"]);
    expect(foldersHolding([a, b] as never, DOC)).toHaveLength(2);
  });
});

describe("folderTree", () => {
  it("loads the folders under the ones open, all the way down, not the docs in them", async () => {
    const deep = folder("automerge:folder-deep", [DOC]);
    const middle = folder("automerge:folder-middle", ["automerge:folder-deep", "automerge:leaf"]);
    const top = folder("automerge:folder-top", ["automerge:folder-middle"]);
    const loaded: Record<string, Fake> = { "automerge:folder-middle": middle, "automerge:folder-deep": deep };
    const find = vi.fn(async (url: string) => loaded[url]);
    const tree = await folderTree({ find } as never, [top] as never);
    expect(tree.map((handle) => handle.url)).toEqual(["automerge:folder-top", "automerge:folder-middle", "automerge:folder-deep"]);
    expect(find).not.toHaveBeenCalledWith("automerge:leaf");
    expect(foldersHolding(tree, DOC)).toHaveLength(3);
  });
});

describe("announce", () => {
  afterEach(() => vi.useRealTimers());

  // a folder that's visible but closed in someone's sidebar: open in the
  // repo, but what's between it and the doc isn't
  it("tells every folder holding where you are, found all the way down from the ones open", async () => {
    const deep = folder("automerge:folder-deep", [DOC]);
    const top = folder("automerge:folder-top", ["automerge:folder-deep"]);
    const handles = { top };
    const find = vi.fn(async (url: string) => (url === deep.url ? deep : null));
    const presence = announce({
      repo: () => ({ handles, find }) as never,
      from: "tab:doc",
      where: () => ({ doc: DOC }),
      who: () => who,
    });
    await vi.waitFor(() => expect(top.broadcast).toHaveBeenCalled());
    expect(top.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "here", from: "tab:doc", who, doc: DOC });
    expect(deep.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "here", from: "tab:doc", who, doc: DOC });
    presence.stop();
    expect(top.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "bye", from: "tab:doc" });
  });

  it("moving on, the folders it's not in are told bye, and the ones it is, here", async () => {
    const one = folder("automerge:one", [DOC]);
    const two = folder("automerge:two", ["automerge:else"]);
    const handles = { one, two };
    let where: { doc: string } | null = { doc: DOC };
    const presence = announce({
      repo: () => ({ handles, find: async () => null }) as never,
      from: "tab:doc",
      where: () => where,
      who: () => who,
    });
    await vi.waitFor(() => expect(one.broadcast).toHaveBeenCalled());
    expect(two.broadcast).not.toHaveBeenCalled();
    where = { doc: "automerge:else" };
    presence.update();
    expect(one.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "bye", from: "tab:doc" });
    await vi.waitFor(() =>
      expect(two.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "here", from: "tab:doc", who, doc: "automerge:else" }),
    );
    presence.stop();
  });

  it("says nothing till it knows who you are", async () => {
    const one = folder("automerge:one", [DOC]);
    const presence = announce({
      repo: () => ({ handles: { one }, find: async () => null }) as never,
      from: "t",
      where: () => ({ doc: DOC }),
      who: () => null,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(one.broadcast).not.toHaveBeenCalled();
    presence.stop();
  });
});
