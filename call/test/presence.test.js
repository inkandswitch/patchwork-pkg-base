import { expect, test, vi } from "vitest";
import { PRESENCE, announce, foldersHolding } from "../src/engine/presence.js";

const folder = (url, docs) => ({
  url,
  isReady: () => true,
  doc: () => ({ docs: docs.map((child) => ({ url: child })) }),
  broadcast: vi.fn(),
});

test("the folders holding your call's doc are told you're in a call there, and bye after", () => {
  const room = "automerge:room";
  const inner = folder("automerge:inner", [room]);
  const outer = folder("automerge:outer", ["automerge:inner"]);
  const who = { contact: "automerge:me", name: "chee", colour: "", avatar: "" };
  expect(foldersHolding([inner, outer], room)).toHaveLength(2);
  const presence = announce({
    repo: () => ({ handles: { inner, outer } }),
    from: "s:call",
    where: () => ({ call: room }),
    who: () => who,
  });
  expect(outer.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "here", from: "s:call", who, call: room });
  presence.stop();
  expect(inner.broadcast).toHaveBeenLastCalledWith({ [PRESENCE]: "bye", from: "s:call" });
});
