import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";

const [asking, setAsking] = createSignal(null);
const [inCall, setInCall] = createSignal(null);
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
    mode: () => "floating",
    stage: () => null,
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

const { CallQuestion } = await import("../src/ui/ui.js");
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

describe("the stage's area", () => {
  test("where the frame says the stage goes, for as long as it says so", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    let area, dispose;
    createRoot((d) => {
      dispose = d;
      area = stageArea(root);
    });
    expect(area()).toBe(null);
    const main = document.createElement("div");
    main.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 200 });
    main.setAttribute("data-call-stage", "");
    root.append(main);
    await tick();
    expect(area()).toMatchObject({ left: 10, top: 20, width: 300, height: 200 });
    main.remove();
    await tick();
    expect(area()).toBe(null);
    dispose();
    root.remove();
  });
});
