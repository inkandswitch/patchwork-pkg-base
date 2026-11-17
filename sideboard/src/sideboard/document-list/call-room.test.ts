import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, type Setter } from "solid-js";

// each ask of the call provider: what it asked, and how to answer it
const asks: { selector: unknown; answer: Setter<unknown> }[] = [];
vi.mock("@inkandswitch/patchwork-providers-solid", () => ({
  subscribe(_element: HTMLElement, selector: unknown, initial: unknown) {
    const [value, answer] = createSignal(initial);
    asks.push({ selector, answer });
    return value;
  },
}));

const { createCallRoom } = await import("./call-room.ts");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  asks.length = 0;
});

function callRoom() {
  return createRoot((done) => {
    dispose = done;
    return createCallRoom(document.createElement("div"));
  });
}

const a = "automerge:2uKZbgcZq4rpgVBGjRGdkJJWT8gf";
const b = "automerge:3hYnbNFW9eNvUrLk9rbE6ViM1Mqr";

describe("which doc your call's in", () => {
  test("asks the call once, for the whole list", () => {
    callRoom();
    expect(asks.map((ask) => ask.selector)).toEqual([{ type: "patchwork:call-now" }]);
  });

  test("no call, no row", () => {
    const isCallRoom = callRoom();
    expect(isCallRoom(a)).toBe(false);
    asks[0].answer({ room: null });
    expect(isCallRoom(a)).toBe(false);
  });

  test("the doc your call's in, any version of it, and no other", () => {
    const isCallRoom = callRoom();
    asks[0].answer({ room: a });
    expect(isCallRoom(a)).toBe(true);
    expect(isCallRoom(`${a}#heads|abc`)).toBe(true);
    expect(isCallRoom(b)).toBe(false);
    asks[0].answer({ room: b });
    expect(isCallRoom(a)).toBe(false);
    expect(isCallRoom(b)).toBe(true);
  });

  test("a call provider turning up late is asked again", () => {
    const isCallRoom = callRoom();
    dispatchEvent(new CustomEvent("patchwork:mounted", { detail: { componentId: "something-else" } }));
    expect(asks).toHaveLength(1);
    dispatchEvent(new CustomEvent("patchwork:mounted", { detail: { componentId: "call-provider" } }));
    expect(asks).toHaveLength(2);
    asks[1].answer({ room: a });
    expect(isCallRoom(a)).toBe(true);
  });
});
