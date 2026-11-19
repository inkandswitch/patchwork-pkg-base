import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESENCE, announce, foldersHolding } from "./presence.js";

type Fake = { url: string; doc: () => unknown; isReady: () => boolean; broadcast: ReturnType<typeof vi.fn> };
const folder = (url: string, docs: string[]): Fake => ({
  url,
  doc: () => ({ title: url, docs: docs.map((child) => ({ url: child, type: "x" })) }),
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

describe("announce", () => {
  afterEach(() => vi.useRealTimers());

  it("tells the folders you're there, bye when you're not, and bye to all at the end", () => {
    vi.useFakeTimers();
    const one = folder("automerge:one", [DOC]);
    const two = folder("automerge:two", ["automerge:else"]);
    const handles = { one, two };
    let where: { doc: string } | null = { doc: DOC };
    const presence = announce({ repo: () => ({ handles }) as never, from: "tab:doc", where: () => where, who: () => who });
    expect(one.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "here", from: "tab:doc", who, doc: DOC });
    expect(two.broadcast).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(one.broadcast).toHaveBeenCalledTimes(2);
    where = { doc: "automerge:else" };
    presence.update();
    expect(one.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "bye", from: "tab:doc" });
    expect(two.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "here", from: "tab:doc", who, doc: "automerge:else" });
    presence.stop();
    expect(two.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "bye", from: "tab:doc" });
  });

  it("says nothing till it knows who you are", () => {
    const one = folder("automerge:one", [DOC]);
    const presence = announce({ repo: () => ({ handles: { one } }) as never, from: "t", where: () => ({ doc: DOC }), who: () => null });
    expect(one.broadcast).not.toHaveBeenCalled();
    presence.stop();
  });
});
