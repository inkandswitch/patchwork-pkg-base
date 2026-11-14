import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { generateAutomergeUrl } from "@automerge/automerge-repo/slim";
import { subscribe } from "@inkandswitch/patchwork-providers";

const KEY = "lattice-wm:call";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// subscriptions answer over a MessagePort: a few turns to arrive
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
};

function fakeHandle(url) {
  const listeners = new Set();
  return {
    url,
    doc: () => ({}),
    broadcast: vi.fn(),
    on: vi.fn((name, fn) => name === "ephemeral-message" && listeners.add(fn)),
    off: vi.fn((name, fn) => listeners.delete(fn)),
    emit: (message) => listeners.forEach((fn) => fn({ message, senderId: "their-tab" })),
    listeners,
  };
}

let engine, CallProvider, handles, host, deep, stop;
beforeEach(async () => {
  delete globalThis[Symbol.for("patchwork-call:lasting")];
  vi.resetModules();
  handles = new Map();
  globalThis.repo = {
    find: vi.fn(async (url) => {
      if (!handles.has(url)) handles.set(url, fakeHandle(url));
      return handles.get(url);
    }),
  };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  engine = await import("../src/engine/call.js");
  ({ CallProvider } = await import("../src/provider.js"));
  host = document.createElement("div");
  deep = host.appendChild(document.createElement("div")).appendChild(document.createElement("div"));
  document.body.append(host);
  stop = CallProvider(host);
});

afterEach(() => {
  stop?.();
  host.remove();
  engine.hangUp();
  vi.restoreAllMocks();
});

const mounted = (url, from = deep) =>
  from.dispatchEvent(new CustomEvent("patchwork:mounted", { bubbles: true, composed: true, detail: { url, toolId: "t" } }));
const unmounted = (url, from = deep) =>
  from.dispatchEvent(new CustomEvent("patchwork:unmounted", { bubbles: true, composed: true, detail: { url, toolId: "t" } }));
const here = (url, from = "x") => handles.get(url).emit({ [KEY]: "here", from, who: { name: "ana" } });

describe("docs on screen", () => {
  test("a doc mounted anywhere inside is heard, and on screen", async () => {
    const url = generateAutomergeUrl();
    mounted(url);
    await settle();
    here(url);
    expect(engine.call.rooms().map((r) => r.url)).toEqual([url]);
  });

  test("mounted twice, it stays till it's unmounted twice", async () => {
    const url = generateAutomergeUrl();
    mounted(url);
    mounted(url);
    await settle();
    here(url);
    unmounted(url);
    expect(engine.call.rooms()).toHaveLength(1);
    unmounted(url);
    expect(engine.call.rooms()).toHaveLength(0);
    expect(handles.get(url).listeners.size).toBe(0);
  });

  test("a version of it is the same doc", async () => {
    const url = generateAutomergeUrl();
    mounted(`${url}#heads|abc`);
    await settle();
    here(url);
    expect(engine.call.rooms()).toHaveLength(1);
    unmounted(url);
    expect(engine.call.rooms()).toHaveLength(0);
  });

  test("a component that isn't a doc is nothing", async () => {
    deep.dispatchEvent(new CustomEvent("patchwork:mounted", { bubbles: true, detail: { componentId: "c" } }));
    await settle();
    expect(globalThis.repo.find).not.toHaveBeenCalled();
  });
});

describe("arriving late", () => {
  test("docs already on screen when it mounts are heard, and their unmounts pair up", async () => {
    stop();
    const url = generateAutomergeUrl();
    const view = deep.appendChild(document.createElement("patchwork-view"));
    view.setAttribute("doc-url", `${url}#heads|abc`);
    stop = CallProvider(host);
    await settle();
    here(url);
    expect(engine.call.rooms().map((r) => r.url)).toEqual([url]);
    unmounted(url, view);
    expect(engine.call.rooms()).toHaveLength(0);
  });
});

describe("subscriptions", () => {
  test("patchwork:call says whether there's a call on a doc", async () => {
    const url = generateAutomergeUrl();
    const heard = [];
    const off = subscribe(deep, { type: "patchwork:call", url }, (value) => heard.push(value));
    await settle();
    expect(heard.at(-1)).toEqual({ here: false, others: 0, elsewhere: false });
    here(url);
    await settle();
    expect(heard.at(-1)).toEqual({ here: false, others: 1, elsewhere: false });
    // asked about, it's heard, but it isn't on screen
    expect(engine.call.rooms()).toHaveLength(0);
    off();
  });

  test("patchwork:call-room says a room is here, and what it's called", async () => {
    const url = generateAutomergeUrl();
    const heard = [];
    const off = subscribe(deep, { type: "patchwork:call-room", url, name: "proj" }, (value) => heard.push(value));
    await settle();
    expect(heard.at(-1)).toEqual({ here: false, others: 0, elsewhere: false });
    here(url);
    expect(engine.call.nameOf(url)).toBe("proj");
    expect(engine.call.rooms().map((r) => r.name)).toEqual(["proj"]);
    off();
    await settle();
    expect(engine.call.rooms()).toHaveLength(0);
    expect(engine.call.nameOf(url)).toBe("");
  });

  test("patchwork:call-video says a frame can show the video, and is told when it's wanted", async () => {
    const heard = [];
    const off = subscribe(deep, { type: "patchwork:call-video" }, (value) => heard.push(value));
    await settle();
    expect(heard.at(-1)).toEqual({ wanted: false });
    expect(engine.call.canShowVideo()).toBe(true);
    off();
    await settle();
    expect(engine.call.canShowVideo()).toBe(false);
  });

  test("patchwork:call-video says whether the frame's showing it right now", async () => {
    const off = subscribe(deep, { type: "patchwork:call-video", showing: true }, () => {});
    await settle();
    expect(engine.call.videoShowing()).toBe(true);
    off();
    await settle();
    expect(engine.call.videoShowing()).toBe(false);
  });
});

describe("asking", () => {
  test("patchwork:call ask puts the question, where it was asked", async () => {
    const url = generateAutomergeUrl();
    deep.dispatchEvent(
      new CustomEvent("patchwork:call", { bubbles: true, composed: true, detail: { action: "ask", url, at: { x: 1, y: 2 } } }),
    );
    expect(engine.call.asking()).toEqual({ url, at: { x: 1, y: 2 } });
  });

  test("anything else asked is nothing", () => {
    deep.dispatchEvent(new CustomEvent("patchwork:call", { bubbles: true, detail: { action: "explode" } }));
    expect(engine.call.asking()).toBe(null);
  });
});

test("stopped, it hears nothing more", async () => {
  stop();
  stop = null;
  mounted(generateAutomergeUrl());
  await settle();
  expect(globalThis.repo.find).not.toHaveBeenCalled();
});

describe("what floats", () => {
  test("the provider draws the question when something asks, and takes it away when stopped", async () => {
    const url = generateAutomergeUrl();
    deep.dispatchEvent(new CustomEvent("patchwork:call", { bubbles: true, detail: { action: "ask", url } }));
    await settle();
    const question = host.querySelector(".patchwork-call > .patchwork-call-question");
    expect(question?.hasAttribute("data-open")).toBe(true);
    stop();
    stop = null;
    expect(host.querySelector(".patchwork-call")).toBe(null);
  });
});
