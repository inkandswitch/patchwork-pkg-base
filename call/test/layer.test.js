import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";

const [asking, setAsking] = createSignal(null);
const [inCall, setInCall] = createSignal(null);
const [mode, setMode] = createSignal("floating");
const [showing, setShowing] = createSignal(false);
const [staged, setStaged] = createSignal(null);
const join = vi.fn();
const names = { "automerge:other": "other" };
vi.mock("../src/engine/call.js", () => {
  const call = {
    get: () => inCall(),
    peers: () => [],
    me: () => ({ name: "me" }),
    local: () => null,
    stream: () => null,
    screen: () => null,
    mode: () => mode(),
    videoShowing: () => showing(),
    stage: () => staged(),
    full: () => false,
    asking: () => asking(),
    stopAsking: () => setAsking(null),
    nameOf: (url) => names[url] ?? "",
    settings: { floating: {} },
    floatKey: (id) => id,
    find: () => null,
  };
  const nothing = () => {};
  return {
    call,
    onCallIn: () => [],
    join,
    setFloating: nothing,
    hideFloating: nothing,
    showFloating: nothing,
    toggleStage: nothing,
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
