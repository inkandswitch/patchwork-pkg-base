import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";

const [asking, setAsking] = createSignal(null);
const [inCall, setInCall] = createSignal(null);
const [mode, setMode] = createSignal("floating");
const [showing, setShowing] = createSignal(false);
const [staged, setStaged] = createSignal(null);
const [filling, setFilling] = createSignal(null);
const [peers, setPeers] = createSignal([]);
const [screens, setScreens] = createSignal({});
const [onCanvas, setOnCanvas] = createSignal([]);
const join = vi.fn();
const toggleFill = vi.fn();
const setFloating = vi.fn();
const names = { "automerge:other": "other" };
vi.mock("../src/engine/call.js", () => {
  const call = {
    get: () => inCall(),
    peers: () => peers(),
    me: () => ({ name: "me" }),
    local: () => null,
    stream: () => null,
    screen: (id) => screens()[id] ?? null,
    mode: () => mode(),
    videoShowing: () => showing(),
    stage: () => staged(),
    filling: () => (staged() ? { id: staged(), screen: !!filling()?.screen } : null),
    full: () => false,
    asking: () => asking(),
    stopAsking: () => setAsking(null),
    nameOf: (url) => names[url] ?? "",
    settings: { floating: {} },
    floatKey: (id, screen) => (screen ? `${id}/screen` : id),
    find: () => null,
    onCanvas: (id) => onCanvas().includes(id),
  };
  const nothing = () => {};
  return {
    call,
    onCallIn: () => [],
    join,
    setFloating,
    hideFloating: nothing,
    showFloating: nothing,
    toggleStage: nothing,
    toggleFill,
    setFull: nothing,
    closeStage: nothing,
  };
});

// happy-dom has no web animations: floating faces animate as they arrive
HTMLElement.prototype.animate ??= function () {
  return { finished: Promise.resolve(), cancel() {}, onfinish: null };
};

const { CallQuestion, CallFloating, CallStage } = await import("../src/ui/ui.js");
const { stageArea } = await import("../src/ui/area.js");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the question", () => {
  let host, dispose;
  beforeEach(() => {
    setAsking(null);
    setInCall(null);
    join.mockClear();
    host = document.body.appendChild(document.createElement("div"));
    dispose = render(() => html`<${CallQuestion} />`, host);
  });
  afterEach(() => {
    dispose();
    host.remove();
  });
  const question = () => host.querySelector(".patchwork-call-question");
  const button = (words) => [...host.querySelectorAll("button")].find((b) => b.textContent.includes(words));

  test("nothing asked, nothing shown", () => {
    expect(question()?.hasAttribute("data-open") ?? false).toBe(false);
  });

  test("asked, it's there, where it was asked", async () => {
    setAsking({ url: "automerge:here", at: { x: 40, y: 50 } });
    await tick();
    expect(question().hasAttribute("data-open")).toBe(true);
    expect(question().style.left).toBe("40px");
    expect(question().textContent).toContain("start a call here?");
  });

  test("just voice joins without your camera, and the question's gone", async () => {
    setAsking({ url: "automerge:here", at: null });
    await tick();
    button("just voice").click();
    expect(join).toHaveBeenCalledWith("automerge:here", { video: false });
    expect(asking()).toBe(null);
  });

  test("in a call somewhere else, it says joining this leaves that", async () => {
    setInCall({ room: "automerge:other" });
    setAsking({ url: "automerge:here", at: null });
    await tick();
    expect(question().textContent).toContain("leaves the call in other");
  });
});

describe("floating faces", () => {
  test("float while faces are in the sidebar but the video isn't showing there", async () => {
    setInCall({ room: "automerge:here", mic: true });
    setMode("sidebar");
    setShowing(false);
    const host = document.body.appendChild(document.createElement("div"));
    const dispose = render(() => html`<${CallFloating} area=${() => null} />`, host);
    expect(host.querySelector(".patchwork-call-floating")).not.toBe(null);
    setShowing(true);
    expect(host.querySelector(".patchwork-call-floating")).toBe(null);
    setMode("floating");
    expect(host.querySelector(".patchwork-call-floating")).not.toBe(null);
    dispose();
    host.remove();
    setInCall(null);
  });
});

describe("faces placed in a doc", () => {
  test("they step aside while it's showing them, and come back when it's not", async () => {
    setInCall({ room: "automerge:here", mic: true });
    setPeers([{ id: "p1", name: "ana" }]);
    const host = document.body.appendChild(document.createElement("div"));
    const dispose = render(() => html`<${CallFloating} area=${() => null} />`, host);
    await tick();
    const floating = () => host.querySelectorAll(".patchwork-call-float").length;
    expect(floating()).toBe(2);
    // ana's on a canvas: you still float
    setOnCanvas(["p1"]);
    await tick();
    expect(floating()).toBe(1);
    setOnCanvas([]);
    await tick();
    expect(floating()).toBe(2);
    dispose();
    host.remove();
    setPeers([]);
    setInCall(null);
  });
});

describe("faces floating in the stage's area", () => {
  test("they start near it, given a box (the provider passes its area, which html makes a getter)", async () => {
    setInCall({ room: "automerge:here", mic: true });
    setMode("floating");
    const box = { left: 10, top: 20, width: 300, height: 200 };
    const host = document.body.appendChild(document.createElement("div"));
    const area = () => box;
    const dispose = render(() => html`<${CallFloating} area=${area} /><${CallStage} area=${area} />`, host);
    await tick();
    expect(host.querySelector(".patchwork-call-float")).not.toBe(null);
    setStaged("p1");
    await tick();
    expect(host.querySelector(".patchwork-call-stage").style.width).toBe("300px");
    dispose();
    host.remove();
    setStaged(null);
    setInCall(null);
  });
});

describe("the stage, and faces floating", () => {
  test("someone staged doesn't cover the floating faces", async () => {
    const shown = [];
    const proto = HTMLElement.prototype;
    const saved = { show: proto.showPopover, hide: proto.hidePopover, matches: proto.matches };
    const open = new Set();
    proto.showPopover = function () {
      open.add(this);
      shown.push(this.className);
    };
    proto.hidePopover = function () {
      open.delete(this);
    };
    proto.matches = function (selector) {
      return selector === ":popover-open" ? open.has(this) : saved.matches.call(this, selector);
    };
    try {
      setInCall({ room: "automerge:here", mic: true });
      setMode("floating");
      const host = document.body.appendChild(document.createElement("div"));
      host.className = "patchwork-call";
      const dispose = render(
        () => html`<${CallFloating} area=${() => null} /><${CallStage} area=${() => null} />`,
        host,
      );
      await tick();
      expect(shown.at(-1)).toBe("patchwork-call-floating");
      setStaged("p1");
      await tick();
      await tick();
      expect(shown).toContain("patchwork-call-stage");
      expect(shown.at(-1)).toBe("patchwork-call-floating");
      dispose();
      host.remove();
    } finally {
      Object.assign(proto, { showPopover: saved.show, hidePopover: saved.hide, matches: saved.matches });
      setStaged(null);
      setInCall(null);
    }
  });
});

describe("the stage's area", () => {
  const frame = () => new Promise((resolve) => setTimeout(resolve, 40));

  test("where the frame says the stage goes, for as long as it says so", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    let area, dispose;
    createRoot((d) => {
      dispose = d;
      area = stageArea(root, () => true);
    });
    expect(area()).toBe(null);
    const main = document.createElement("div");
    main.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 200 });
    main.setAttribute("data-call-stage", "");
    root.append(main);
    await frame();
    expect(area()).toMatchObject({ left: 10, top: 20, width: 300, height: 200 });
    main.remove();
    await frame();
    expect(area()).toBe(null);
    dispose();
    root.remove();
  });

  test("out of a call, the frame's changes aren't looked at", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const [active, setActive] = createSignal(false);
    const looked = vi.spyOn(root, "querySelector");
    let area, dispose;
    createRoot((d) => {
      dispose = d;
      area = stageArea(root, active);
    });
    root.append(document.createElement("p"));
    await frame();
    expect(looked).not.toHaveBeenCalled();
    const main = document.createElement("div");
    main.getBoundingClientRect = () => ({ left: 1, top: 2, width: 3, height: 4 });
    main.setAttribute("data-call-stage", "");
    root.append(main);
    setActive(true);
    await frame();
    expect(area()).toMatchObject({ width: 3 });
    // found, it isn't looked for again as the frame changes
    looked.mockClear();
    root.append(document.createElement("p"));
    await frame();
    expect(looked).not.toHaveBeenCalled();
    dispose();
    root.remove();
  });
});

describe("a screen being shared", () => {
  const ana = { id: "p1", name: "ana", mic: true, connection: "connected" };
  let host, dispose;
  beforeEach(async () => {
    setInCall({ room: "automerge:here", mic: true });
    setMode("floating");
    setPeers([ana]);
    host = document.body.appendChild(document.createElement("div"));
    host.className = "patchwork-call";
    dispose = render(() => html`<${CallFloating} area=${() => null} /><${CallStage} area=${() => null} />`, host);
    await tick();
  });
  afterEach(() => {
    dispose();
    host.remove();
    setScreens({});
    setPeers([]);
    setStaged(null);
    setFilling(null);
    setInCall(null);
    toggleFill.mockClear();
  });
  const floats = () => [...host.querySelectorAll(".patchwork-call-float")];
  const named = (name) => floats().find((float) => float.querySelector(".patchwork-call-float-name").textContent.includes(name));

  test("floats, a face of its own, and doesn't fill anything", async () => {
    expect(floats()).toHaveLength(2);
    setScreens({ p1: new MediaStream() });
    await tick();
    expect(floats()).toHaveLength(3);
    const screen = named("ana's screen");
    expect(screen.dataset.shape).toBe("screen");
    expect(screen.querySelector(".patchwork-call-screen")).not.toBe(null);
    expect(host.querySelector(".patchwork-call-stage")).toBe(null);
    setScreens({});
    await tick();
    expect(floats()).toHaveLength(2);
  });

  test("each floating face can be made to fill the window, its screen too", async () => {
    setScreens({ p1: new MediaStream() });
    await tick();
    named("you").querySelector("[data-fill]").click();
    expect(toggleFill).toHaveBeenLastCalledWith("me", false);
    named("ana's screen").querySelector("[data-fill]").click();
    expect(toggleFill).toHaveBeenLastCalledWith("p1", true);
  });

  test("filling the panes, it's only that: the rest float over it, you too", async () => {
    setScreens({ p1: new MediaStream() });
    setStaged("p1");
    setFilling({ screen: true });
    await tick();
    await tick();
    const stage = host.querySelector(".patchwork-call-stage");
    expect(stage.style.width).toBe("100%");
    expect(stage.querySelector(".patchwork-call-screen")).not.toBe(null);
    expect(stage.querySelector(".patchwork-call-them")).toBe(null);
    expect(named("ana's screen").hasAttribute("data-staged")).toBe(true);
    expect(named("ana").hasAttribute("data-staged")).toBe(false);
    expect(named("you").hasAttribute("data-staged")).toBe(false);
    // their face, not their screen
    setFilling({ screen: false });
    await tick();
    expect(stage.querySelector(".patchwork-call-screen")).toBe(null);
    expect(named("ana's screen").hasAttribute("data-staged")).toBe(false);
    expect(floats().find((f) => f.hasAttribute("data-staged")).textContent).not.toContain("screen");
  });
});

describe("something filling the panes, faces in the sidebar", () => {
  test("they float over it, meanwhile", async () => {
    setInCall({ room: "automerge:here", mic: true });
    setMode("sidebar");
    setShowing(true);
    const host = document.body.appendChild(document.createElement("div"));
    const dispose = render(() => html`<${CallFloating} area=${() => null} />`, host);
    expect(host.querySelector(".patchwork-call-floating")).toBe(null);
    setStaged("me");
    expect(host.querySelector(".patchwork-call-floating")).not.toBe(null);
    setStaged(null);
    expect(host.querySelector(".patchwork-call-floating")).toBe(null);
    dispose();
    host.remove();
    setMode("floating");
    setShowing(false);
    setInCall(null);
  });
});

describe("your own screen", () => {
  test("floats too, while you share it", async () => {
    setInCall({ room: "automerge:here", mic: true });
    setMode("floating");
    const host = document.body.appendChild(document.createElement("div"));
    const dispose = render(() => html`<${CallFloating} area=${() => null} />`, host);
    setScreens({ me: new MediaStream() });
    await tick();
    const names = [...host.querySelectorAll(".patchwork-call-float-name")].map((name) => name.textContent.trim());
    expect(names).toContain("your screen");
    dispose();
    host.remove();
    setScreens({});
    setInCall(null);
  });
});

describe("holding a floating face", () => {
  test("it stays under the pointer, whatever else changes meanwhile, and stays where it's let go", async () => {
    const ana = { id: "p1", name: "ana", mic: true, connection: "connected" };
    setInCall({ room: "automerge:here", mic: true });
    setMode("floating");
    setPeers([ana]);
    const proto = HTMLElement.prototype;
    const saved = { capture: proto.setPointerCapture };
    proto.setPointerCapture = () => {};
    const host = document.body.appendChild(document.createElement("div"));
    const dispose = render(() => html`<${CallFloating} area=${() => null} />`, host);
    await tick();
    try {
      const float = host.querySelector(".patchwork-call-float");
      const size = float.querySelector(".patchwork-call-size");
      const was = parseFloat(float.style.width);
      const pointer = (type, target, init) =>
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, ...init }));
      pointer("pointerdown", size, { clientX: 100, clientY: 100, buttons: 1 });
      pointer("pointermove", float, { clientX: 140, clientY: 100, buttons: 1 });
      expect(parseFloat(float.style.width)).toBe(was + 40);
      // someone speaks: everyone's said again
      setPeers([{ ...ana, speaking: true }]);
      await tick();
      expect(parseFloat(float.style.width)).toBe(was + 40);
      // let go where it wasn't heard: the next move, no button held, ends it
      setFloating.mockClear();
      pointer("pointermove", float, { clientX: 300, clientY: 100, buttons: 0 });
      pointer("pointermove", float, { clientX: 400, clientY: 100, buttons: 0 });
      expect(setFloating).toHaveBeenCalledTimes(1);
      expect(setFloating.mock.calls[0][1].width).toBe(was + 40);
    } finally {
      proto.setPointerCapture = saved.capture;
      dispose();
      host.remove();
      setPeers([]);
      setInCall(null);
    }
  });
});
