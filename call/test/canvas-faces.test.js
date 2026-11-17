import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { generateAutomergeUrl } from "@automerge/automerge-repo/slim";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { freshPage, settle, tick } from "./fake.js";

const KEY = "lattice-wm:call";
// happy-dom has no web animations: floating faces animate as they arrive
HTMLElement.prototype.animate ??= function () {
  return { finished: Promise.resolve(), cancel() {}, onfinish: null };
};

// the layout docs: plain objects that notice they've been changed
function layoutDoc(url, doc) {
  const listeners = new Set();
  return {
    url,
    doc: () => doc,
    change(fn) {
      fn(doc);
      listeners.forEach((fn) => fn());
    },
    on: (name, fn) => name === "change" && listeners.add(fn),
    off: (name, fn) => listeners.delete(fn),
    listeners,
  };
}

let engine, CallProvider, handles, layouts, host, deep, stop, roomUrl;
beforeEach(async () => {
  handles = freshPage();
  layouts = new Map();
  const find = globalThis.repo.find;
  globalThis.repo.find = vi.fn(async (url) => layouts.get(url) ?? find(url));
  globalThis.repo.create = vi.fn((doc) => {
    const url = generateAutomergeUrl();
    layouts.set(url, layoutDoc(url, structuredClone(doc)));
    return layouts.get(url);
  });
  engine = await import("../src/engine/call.js");
  ({ CallProvider } = await import("../src/provider.js"));
  host = document.createElement("div");
  deep = host.appendChild(document.createElement("div"));
  document.body.append(host);
  stop = CallProvider(host);
  roomUrl = generateAutomergeUrl();
});
afterEach(() => {
  stop?.();
  host.remove();
  engine.hangUp();
  vi.restoreAllMocks();
});

const place = (url, spots) =>
  deep.dispatchEvent(new CustomEvent("patchwork:call", { bubbles: true, composed: true, detail: { action: "place-faces", url, spots } }));
const said = (room) => room.broadcast.mock.calls.map(([message]) => message).filter((message) => message[KEY] === "here");

describe("the subscription", () => {
  test("out of a call: nobody's here", async () => {
    const heard = [];
    const off = subscribe(deep, { type: "patchwork:call-faces", url: generateAutomergeUrl() }, (value) => heard.push(value));
    await settle();
    expect(heard.at(-1)).toEqual({ here: false, people: [], spots: {} });
    off();
  });

  test("in a call: who's in it, you first", async () => {
    await engine.join(roomUrl);
    const heard = [];
    const off = subscribe(deep, { type: "patchwork:call-faces", url: generateAutomergeUrl() }, (value) => heard.push(value));
    await settle();
    const now = heard.at(-1);
    expect(now.here).toBe(true);
    expect(now.people).toHaveLength(1);
    expect(now.people[0]).toMatchObject({ id: "me", me: true, name: "anonymous" });
    expect(now.people[0].key).toBe(engine.call.get().id);
    off();
  });

  test("placing a face says where, to this doc only, and makes the layout", async () => {
    await engine.join(roomUrl);
    const canvas = generateAutomergeUrl();
    const other = generateAutomergeUrl();
    const heard = [];
    const off = subscribe(deep, { type: "patchwork:call-faces", url: canvas }, (value) => heard.push(value));
    await settle();
    expect(engine.call.layoutUrl()).toBe(null);
    const me = engine.call.personKey("me");
    place(canvas, { [me]: { x: 10, y: 20, size: 120 } });
    place(other, { [me]: { x: 1, y: 1, size: 50 } });
    await settle();
    expect(engine.call.layoutUrl()).toMatch(/^automerge:/);
    expect(heard.at(-1).spots).toEqual({ [me]: { x: 10, y: 20, size: 120 } });
    // and taken off
    place(canvas, { [me]: null });
    await settle();
    expect(heard.at(-1).spots).toEqual({});
    off();
  });

  test("with no call, placing does nothing", async () => {
    place(generateAutomergeUrl(), { someone: { x: 1, y: 1, size: 50 } });
    await settle();
    expect(engine.call.layoutUrl()).toBe(null);
    expect(globalThis.repo.create).not.toHaveBeenCalled();
  });
});

describe("floating faces step aside", () => {
  test("while something's showing the doc they're placed on, and not after", async () => {
    await engine.join(roomUrl);
    const canvas = generateAutomergeUrl();
    place(canvas, { [engine.call.personKey("me")]: { x: 0, y: 0, size: 100 } });
    await settle();
    // placed, but nothing's showing that doc
    expect(engine.call.onCanvas("me")).toBe(false);
    const off = subscribe(deep, { type: "patchwork:call-faces", url: canvas }, () => {});
    await settle();
    expect(engine.call.onCanvas("me")).toBe(true);
    // somewhere else, they float
    const elsewhere = subscribe(deep, { type: "patchwork:call-faces", url: generateAutomergeUrl() }, () => {});
    await settle();
    off();
    await settle();
    expect(engine.call.onCanvas("me")).toBe(false);
    elsewhere();
  });

  test("someone not placed keeps floating", async () => {
    await engine.join(roomUrl);
    const off = subscribe(deep, { type: "patchwork:call-faces", url: generateAutomergeUrl() }, () => {});
    await settle();
    expect(engine.call.onCanvas("me")).toBe(false);
    off();
  });

  test("two things showing a doc: it's shown till both let go", async () => {
    await engine.join(roomUrl);
    const canvas = generateAutomergeUrl();
    place(canvas, { [engine.call.personKey("me")]: { x: 0, y: 0, size: 100 } });
    const a = subscribe(deep, { type: "patchwork:call-faces", url: canvas }, () => {});
    const b = subscribe(deep, { type: "patchwork:call-faces", url: canvas }, () => {});
    await settle();
    a();
    await settle();
    expect(engine.call.onCanvas("me")).toBe(true);
    b();
    await settle();
    expect(engine.call.onCanvas("me")).toBe(false);
  });
});

describe("agreeing over the room's channel", () => {
  const join = async () => {
    await engine.join(roomUrl);
    return handles.get(roomUrl);
  };
  // a peer who sorts after us, so they're the one to offer (and nothing connects)
  const peerSays = (room, fields) => room.emit({ [KEY]: "here", from: "zzzz-them", who: { name: "bo" }, ...fields });

  test("says no layout until something needs one", async () => {
    const room = await join();
    await tick();
    expect(said(room).length).toBeGreaterThan(0);
    expect(said(room).every((message) => message.layout === undefined)).toBe(true);
  });

  test("whoever places first announces the layout at once", async () => {
    const room = await join();
    place(generateAutomergeUrl(), { [engine.call.personKey("me")]: { x: 0, y: 0, size: 100 } });
    await settle();
    expect(said(room).at(-1).layout).toBe(engine.call.layoutUrl());
  });

  test("a late joiner takes the one it hears, replayed from before it joined", async () => {
    const theirs = layoutDoc(generateAutomergeUrl(), { spots: { "x|y": { x: 1, y: 2, size: 80 } } });
    layouts.set(theirs.url, theirs);
    const { hearRoom } = engine;
    hearRoom(roomUrl);
    await settle();
    peerSays(handles.get(roomUrl), { layout: theirs.url });
    await engine.join(roomUrl);
    await settle();
    expect(engine.call.layoutUrl()).toBe(theirs.url);
  });

  // a layout of someone else's that sorts below (or above) `than`
  const madeOn = (side, than, spots = {}) => {
    for (;;) {
      const url = generateAutomergeUrl();
      if ((side === "below") === (url < than)) {
        layouts.set(url, layoutDoc(url, { spots }));
        return url;
      }
    }
  };

  test("a lower one heard moves us to it, with what we'd placed", async () => {
    const room = await join();
    const canvas = generateAutomergeUrl();
    const me = engine.call.personKey("me");
    place(canvas, { [me]: { x: 5, y: 5, size: 100 } });
    await settle();
    const mine = engine.call.layoutUrl();
    const lower = madeOn("below", mine, { "k|them": { x: 1, y: 1, size: 60 } });
    peerSays(room, { layout: lower });
    await settle();
    expect(engine.call.layoutUrl()).toBe(lower);
    const spots = layouts.get(lower).doc().spots;
    expect(Object.keys(spots).sort()).toEqual([`${canvas}|${me}`, "k|them"].sort());
    expect(said(room).at(-1).layout).toBe(lower);
  });

  test("a higher one is ignored", async () => {
    const room = await join();
    place(generateAutomergeUrl(), { a: { x: 5, y: 5, size: 100 } });
    await settle();
    const mine = engine.call.layoutUrl();
    peerSays(room, { layout: madeOn("above", mine) });
    await settle();
    expect(engine.call.layoutUrl()).toBe(mine);
  });

  test("hung up, nothing's kept", async () => {
    await join();
    place(generateAutomergeUrl(), { a: { x: 0, y: 0, size: 100 } });
    await settle();
    engine.hangUp();
    expect(engine.call.layoutUrl()).toBe(null);
    expect(engine.call.people()).toEqual([]);
  });

  test("a peer that says no layout (an older call) changes nothing", async () => {
    const room = await join();
    peerSays(room, {});
    await settle();
    expect(engine.call.layoutUrl()).toBe(null);
  });
});
