import { expect, test, vi } from "vitest";
import { PRESENCE, announce, foldersHolding } from "../src/engine/presence.js";

const folder = (url, docs) => ({
  url,
  isReady: () => true,
  doc: () => ({ docs: docs.map((child) => ({ url: child, type: child.includes("folder") ? "folder" : "x" })) }),
  broadcast: vi.fn(),
});

test("every folder holding your call's doc, found down from the ones open, is told you're in a call there", async () => {
  const room = "automerge:room";
  const inner = folder("automerge:folder-inner", [room]);
  const outer = folder("automerge:folder-outer", ["automerge:folder-inner"]);
  const who = { contact: "automerge:me", name: "chee", colour: "", avatar: "" };
  expect(foldersHolding([inner, outer], room)).toHaveLength(2);
  // only the outer one's open (a closed folder in the sidebar)
  const presence = announce({
    repo: () => ({ handles: { outer }, find: async (url) => (url === inner.url ? inner : null) }),
    from: "s:call",
    where: () => ({ call: room }),
    who: () => who,
  });
  await vi.waitFor(() => expect(outer.broadcast).toHaveBeenCalled());
  expect(outer.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "here", from: "s:call", who, call: room });
  expect(inner.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "here", from: "s:call", who, call: room });
  presence.stop();
  expect(inner.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "bye", from: "s:call" });
});
