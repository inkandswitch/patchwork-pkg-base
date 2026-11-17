import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";

// the engine, as far as a face reads it: who's in the call, and finding them
const [peers, setPeers] = createSignal([]);
const [inCall, setInCall] = createSignal(null);
vi.mock("../src/engine/call.js", () => {
  const call = {
    get: () => inCall(),
    peers: () => peers(),
    me: () => ({ name: "me", contact: "", colour: "", avatar: "" }),
    local: () => null,
    stream: () => null,
    screen: () => null,
    mode: () => "floating",
    stage: () => null,
    full: () => false,
    asking: () => null,
    stopAsking: () => {},
    nameOf: () => "",
    settings: { floating: {} },
    floatKey: (id) => id,
    find({ peer, contact }) {
      return (
        peers().find((p) => peer && p.peer === peer) ?? peers().find((p) => contact && p.contact === contact) ?? null
      );
    },
  };
  const nothing = () => {};
  return {
    call,
    onCallIn: () => [],
    join: nothing,
    setFloating: nothing,
    hideFloating: nothing,
    showFloating: nothing,
    toggleStage: nothing,
    toggleFill: nothing,
    setFull: nothing,
    closeStage: nothing,
  };
});

const { names } = await import("../src/ui/ui.js");
const { CallFace } = await import("../src/call-face.js");

describe("names", () => {
  test("one, two, or more of them", () => {
    expect(names([])).toBe("");
    expect(names(["chee"])).toBe("chee");
    expect(names(["chee", "mimi"])).toBe("chee and mimi");
    expect(names(["chee", "mimi", "agnes"])).toBe("chee, mimi and agnes");
  });
});

describe("call-face", () => {
  const ana = { id: "p1", peer: "tab-1", contact: "automerge:c1", name: "ana", colour: "", avatar: "", mic: true };
  let element, stop;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  beforeEach(() => {
    setPeers([]);
    setInCall(null);
    element = document.createElement("div");
    document.body.append(element);
  });
  afterEach(() => {
    stop?.();
    element.remove();
  });

  test("nobody's face, out of a call", () => {
    element.setAttribute("contact", "automerge:c1");
    stop = CallFace(element);
    expect(element.querySelector(".patchwork-call-face")).toBe(null);
  });

  test("their face while they're in your call, by who they are", () => {
    setInCall({ room: "automerge:r", mic: true });
    setPeers([ana]);
    element.setAttribute("contact", "automerge:c1");
    element.setAttribute("size", "44");
    stop = CallFace(element);
    const face = element.querySelector(".patchwork-call-face");
    expect(face).not.toBe(null);
    expect(face.style.getPropertyValue("--call-face-size")).toBe("44px");
    expect(face.getAttribute("title")).toBe("ana");
  });

  test("by the tab they're in, too, and without their name when asked", () => {
    setInCall({ room: "automerge:r", mic: true });
    setPeers([ana]);
    element.setAttribute("peer", "tab-1");
    element.setAttribute("no-title", "");
    stop = CallFace(element);
    expect(element.querySelector(".patchwork-call-face").hasAttribute("title")).toBe(false);
  });

  test("someone else asked for: gone", async () => {
    setInCall({ room: "automerge:r", mic: true });
    setPeers([ana]);
    element.setAttribute("contact", "automerge:c1");
    stop = CallFace(element);
    expect(element.querySelector(".patchwork-call-face")).not.toBe(null);
    element.setAttribute("contact", "automerge:nobody");
    await flush();
    expect(element.querySelector(".patchwork-call-face")).toBe(null);
  });

  test("while they're connecting, a quilt being mended: eight patches round theirs, anticlockwise", () => {
    setInCall({ room: "automerge:r", mic: true });
    setPeers([{ ...ana, connection: "connecting" }]);
    element.setAttribute("contact", "automerge:c1");
    stop = CallFace(element);
    const quilt = element.querySelector(".patchwork-call-face > .patchwork-call-quilt");
    expect(quilt?.getAttribute("aria-label")).toBe("connecting");
    const patches = [...quilt.querySelectorAll(".patchwork-call-quilt-patch")];
    // down the left, along the bottom, up the right, back along the top
    expect(patches.map((patch) => patch.style.gridArea.replace(/\s/g, ""))).toEqual([
      "1/1", "2/1", "3/1", "3/2", "3/3", "2/3", "1/3", "1/2",
    ]);
    expect(patches.map((patch) => patch.style.getPropertyValue("--i"))).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
    // a patch is never mended with what it was
    for (const patch of patches) {
      expect(patch.style.getPropertyValue("--was")).not.toBe(patch.style.getPropertyValue("--now"));
    }
    expect(quilt.querySelector(".patchwork-call-quilt-middle")).not.toBe(null);
  });

  test("connected, no quilt", async () => {
    setInCall({ room: "automerge:r", mic: true });
    setPeers([{ ...ana, connection: "connecting" }]);
    element.setAttribute("contact", "automerge:c1");
    stop = CallFace(element);
    expect(element.querySelector(".patchwork-call-quilt")).not.toBe(null);
    setPeers([{ ...ana, connection: "connected" }]);
    await flush();
    expect(element.querySelector(".patchwork-call-quilt")).toBe(null);
  });

  test("stopped, it's gone", () => {
    setInCall({ room: "automerge:r", mic: true });
    setPeers([ana]);
    element.setAttribute("contact", "automerge:c1");
    CallFace(element)();
    expect(element.querySelector(".patchwork-call-face")).toBe(null);
  });
});
