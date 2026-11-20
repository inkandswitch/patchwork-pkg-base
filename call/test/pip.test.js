import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";

const [inCall, setInCall] = createSignal(null);
const [peers, setPeers] = createSignal([]);
const [screens, setScreens] = createSignal({});
const setMic = vi.fn((on) => setInCall({ ...inCall(), mic: on }));
const setCamera = vi.fn();
const hangUp = vi.fn(() => setInCall(null));
vi.mock("../src/engine/call.js", () => {
  const call = {
    get: () => inCall(),
    peers: () => peers(),
    me: () => ({ name: "me" }),
    sharp: () => false,
    local: () => null,
    stream: () => null,
    screen: (id) => screens()[id] ?? null,
    nameOf: () => "the project",
    settings: { floating: {} },
    floatKey: (id) => id,
    find: () => null,
  };
  const nothing = () => {};
  return {
    call,
    hangUp,
    setMic,
    setCamera,
    onCallIn: () => [],
    join: nothing,
    setFloating: nothing,
    hideFloating: nothing,
    showFloating: nothing,
    toggleStage: nothing,
    toggleFill: nothing,
    setFull: nothing,
    closeStage: nothing,
    toggleSharp: nothing,
  };
});

const { openPip, closePip, holdPip, canPip, pipOpen } = await import("../src/ui/pip.js");
const { pipWindow, onPipChange } = await import("../src/engine/pip.js");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// a window of its own, as chrome's picture in picture gives: a document, and
// closed, it's gone (pagehide)
function fakeWindow() {
  const win = new EventTarget();
  win.document = document.implementation.createHTMLDocument("");
  win.close = vi.fn(() => win.dispatchEvent(new Event("pagehide")));
  return win;
}

let requestWindow, actions;
beforeEach(() => {
  setInCall({ room: "automerge:room", mic: true, camera: false });
  setPeers([]);
  setScreens({});
  requestWindow = vi.fn(async () => fakeWindow());
  vi.stubGlobal("documentPictureInPicture", { requestWindow });
  actions = {};
  vi.stubGlobal("navigator", {
    ...globalThis.navigator,
    mediaSession: { setActionHandler: (name, fn) => (actions[name] = fn) },
  });
});
afterEach(() => {
  closePip();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const pipDoc = () => pipWindow()?.document;
const pipButton = (label) => pipDoc().querySelector(`button[aria-label="${label}"]`);

describe("opening it", () => {
  test("only where there's picture in picture", async () => {
    vi.stubGlobal("documentPictureInPicture", undefined);
    expect(canPip()).toBe(false);
    expect(await openPip()).toBe(null);
  });

  test("only in a call", async () => {
    setInCall(null);
    expect(await openPip()).toBe(null);
    expect(requestWindow).not.toHaveBeenCalled();
  });

  test("once, however many times it's asked", async () => {
    const [a, b] = await Promise.all([openPip(), openPip()]);
    expect(a).toBe(b);
    expect(await openPip()).toBe(a);
    expect(requestWindow).toHaveBeenCalledTimes(1);
    expect(pipOpen()).toBe(true);
  });

  test("not allowed (no click to open it with), it's not open", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    requestWindow.mockRejectedValueOnce(new DOMException("no", "NotAllowedError"));
    expect(await openPip()).toBe(null);
    expect(pipOpen()).toBe(false);
  });

  test("the page's styles go with it, and it's named for the call", async () => {
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = ".patchwork-call-pip-test { color: red; }";
    await openPip();
    expect(pipDoc().head.textContent).toContain(".patchwork-call-pip-test");
    expect(pipDoc().title).toBe("the project");
    style.remove();
  });

  test("closed, it's gone, and that's heard", async () => {
    const heard = vi.fn();
    const off = onPipChange(heard);
    const win = await openPip();
    expect(heard).toHaveBeenLastCalledWith(win);
    win.close();
    expect(pipOpen()).toBe(false);
    expect(heard).toHaveBeenLastCalledWith(null);
    off();
  });
});

describe("what's in it", () => {
  test("alone, you fill it", async () => {
    await openPip();
    const pip = pipDoc().querySelector(".patchwork-call-pip");
    expect(pip.hasAttribute("data-alone")).toBe(true);
    expect(pip.querySelector(".patchwork-call-pip-me [data-call-id='me']")).not.toBe(null);
    expect(pip.textContent).toContain("no one else here yet");
  });

  test("everyone else, as many across as down, by name; you in the corner", async () => {
    setPeers([
      { id: "a", name: "ana", mic: true },
      { id: "b", name: "bo", mic: false },
      { id: "c", name: "cy", mic: true },
    ]);
    await openPip();
    const pip = pipDoc().querySelector(".patchwork-call-pip");
    expect(pip.hasAttribute("data-alone")).toBe(false);
    const tiles = [...pip.querySelectorAll(".patchwork-call-pip-tile")];
    expect(tiles.map((tile) => tile.querySelector(".patchwork-call-pip-name-text").textContent)).toEqual(["ana", "bo", "cy"]);
    expect(tiles[1].querySelector("[aria-label='muted']")).not.toBe(null);
    expect(tiles[0].querySelector("[aria-label='muted']")).toBe(null);
    expect(pip.querySelector(".patchwork-call-pip-grid").style.getPropertyValue("--columns")).toBe("2");
    // (each face measured, as the page's are: seen.js)
    expect(pip.querySelector(".patchwork-call-pip-tile [data-call-id='a']")).not.toBe(null);
  });

  test("a screen being shared fills it", async () => {
    setPeers([{ id: "a", name: "ana", mic: true, screen: true }]);
    setScreens({ a: new MediaStream() });
    await openPip();
    expect(pipDoc().querySelector(".patchwork-call-pip-screen .patchwork-call-screen")).not.toBe(null);
    expect(pipDoc().querySelector(".patchwork-call-pip-grid")).toBe(null);
  });
});

describe("its buttons, in its own window", () => {
  test("mute, and unmute", async () => {
    await openPip();
    pipButton("mute").click();
    expect(setMic).toHaveBeenCalledWith(false);
    await tick();
    expect(pipButton("unmute").hasAttribute("data-off")).toBe(true);
  });

  test("camera on", async () => {
    await openPip();
    pipButton("camera on").click();
    expect(setCamera).toHaveBeenCalledWith(true);
  });

  test("hang up", async () => {
    await openPip();
    pipButton("hang up").click();
    expect(hangUp).toHaveBeenCalled();
  });
});

describe("held by the provider", () => {
  let stop;
  beforeEach(() => (stop = holdPip(document.body)));
  afterEach(() => stop());

  test("in a call, the browser can open it as you leave the tab; out of one, it can't", () => {
    expect(typeof actions.enterpictureinpicture).toBe("function");
    setInCall(null);
    expect(actions.enterpictureinpicture).toBe(null);
  });

  test("the call over, it's closed", async () => {
    const win = await openPip();
    setInCall(null);
    expect(win.close).toHaveBeenCalled();
    expect(pipOpen()).toBe(false);
  });

  test("opened as you left, it closes as you're back; opened by you, it stays", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    const auto = await actions.enterpictureinpicture();
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(auto.close).toHaveBeenCalled();
    expect(pipOpen()).toBe(false);

    const mine = await openPip();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mine.close).not.toHaveBeenCalled();
    expect(pipOpen()).toBe(true);
  });

  test("stopped, it's closed", async () => {
    const win = await openPip();
    stop();
    expect(win.close).toHaveBeenCalled();
    stop = () => {};
  });
});
