import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { generateAutomergeUrl } from "@automerge/automerge-repo/slim";

const KEY = "lattice-wm:call";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeHandle(url, doc = {}) {
  const listeners = new Set();
  return {
    url,
    doc: () => doc,
    broadcast: vi.fn(),
    on: vi.fn((name, fn) => name === "ephemeral-message" && listeners.add(fn)),
    off: vi.fn((name, fn) => listeners.delete(fn)),
    emit: (message, senderId = "their-tab") => listeners.forEach((fn) => fn({ message, senderId })),
    listeners,
  };
}

// every test gets the engine as a new page would: nothing lasting, nothing found
let engine, room, handles;
async function fresh() {
  delete globalThis[Symbol.for("patchwork-call:lasting")];
  vi.resetModules();
  handles = new Map();
  globalThis.repo = {
    find: vi.fn(async (url) => {
      if (!handles.has(url)) handles.set(url, fakeHandle(url));
      return handles.get(url);
    }),
  };
  engine = await import("../src/engine/call.js");
  room = await import("../src/engine/room.js");
}

const here = (handle, from = "x", who = { name: "ana" }) => handle.emit({ [KEY]: "here", from, who });

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal("navigator", {
    ...globalThis.navigator,
    mediaDevices: { getUserMedia: () => Promise.reject(new Error("no media here")), enumerateDevices: async () => [] },
  });
  // happy-dom's has no tracks
  vi.stubGlobal(
    "MediaStream",
    class {
      tracks = [];
      getTracks = () => [...this.tracks];
      getVideoTracks = () => this.tracks.filter((t) => t.kind === "video");
      addTrack = (t) => this.tracks.push(t);
      removeTrack = (t) => (this.tracks = this.tracks.filter((x) => x !== t));
    },
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await fresh();
});

afterEach(() => {
  engine.hangUp();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("hearing a room", () => {
  test("says hello once, however many are hearing it", async () => {
    const url = generateAutomergeUrl();
    engine.hearRoom(url);
    engine.hearRoom(url, { onScreen: true });
    await tick();
    const handle = handles.get(url);
    expect(handle.broadcast).toHaveBeenCalledTimes(1);
    expect(handle.broadcast).toHaveBeenCalledWith({ [KEY]: "hello" });
  });

  test("whoever's on a call there is heard, and listed while it's on screen", async () => {
    const url = generateAutomergeUrl();
    const offHearing = engine.hearRoom(url);
    await tick();
    here(handles.get(url));
    expect(engine.onCallIn(url)).toHaveLength(1);
    expect(engine.call.rooms()).toEqual([]);
    const offScreen = engine.hearRoom(url, { onScreen: true });
    expect(engine.call.rooms().map((r) => r.url)).toEqual([url]);
    expect(engine.call.rooms()[0].others).toHaveLength(1);
    offScreen();
    expect(engine.call.rooms()).toEqual([]);
    offHearing();
  });

  test("it stops hearing only when the last one stops", async () => {
    const url = generateAutomergeUrl();
    const one = engine.hearRoom(url);
    const two = engine.hearRoom(url);
    await tick();
    const handle = handles.get(url);
    one();
    one(); // twice is once
    expect(handle.off).not.toHaveBeenCalled();
    two();
    expect(handle.off).toHaveBeenCalledTimes(1);
    expect(handle.listeners.size).toBe(0);
  });

  test("a version of a doc is the same room", async () => {
    const url = generateAutomergeUrl();
    engine.hearRoom(`${url}#heads|abc`);
    engine.hearRoom(url);
    await tick();
    expect(globalThis.repo.find).toHaveBeenCalledTimes(1);
    expect(handles.get(url).on).toHaveBeenCalledTimes(1);
  });

  test("a key room is heard as nothing, for now", async () => {
    const key = room.keyRoom(new Uint8Array(32).fill(7));
    const off = engine.hearRoom(key, { onScreen: true });
    await tick();
    expect(() => off()).not.toThrow();
    expect(globalThis.repo.find).not.toHaveBeenCalled();
  });
});

describe("names", () => {
  test("the name it's heard by, else the doc's title", async () => {
    const url = generateAutomergeUrl();
    handles.set(url, fakeHandle(url, { title: "the doc" }));
    const off = engine.hearRoom(url, { onScreen: true, name: "the project" });
    await tick();
    await tick();
    expect(engine.call.nameOf(url)).toBe("the project");
    off();
    expect(engine.call.nameOf(url)).toBe("the doc");
    expect(engine.call.nameOf(generateAutomergeUrl())).toBe("");
  });
});

describe("joining", () => {
  test("a key room can't be joined yet, and says so", async () => {
    await engine.join(room.keyRoom(new Uint8Array(32)));
    expect(engine.call.get()).toBe(null);
    expect(engine.call.problem()).toBe("calls over a key aren't available yet");
  });

  test("a doc that can't be reached says so", async () => {
    globalThis.repo.find = vi.fn(async () => Promise.reject(new Error("unavailable")));
    await engine.join(generateAutomergeUrl());
    expect(engine.call.get()).toBe(null);
    expect(engine.call.problem()).toBe("couldn't reach that doc");
  });

  test("joining a doc's call starts one there, saying you're here", async () => {
    const url = generateAutomergeUrl();
    await engine.join(url);
    expect(engine.call.get()?.room).toBe(url);
    expect(engine.call.problem()).toBe(null);
    const said = handles.get(url).broadcast.mock.calls.map(([m]) => m[KEY]);
    expect(said).toContain("here");
  });

  test("someone saying hello is answered", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const url = generateAutomergeUrl();
      await engine.join(url);
      const handle = handles.get(url);
      handle.broadcast.mockClear();
      handle.emit({ [KEY]: "hello" });
      handle.emit({ "lattice-wm:hello?": true });
      vi.advanceTimersByTime(300);
      const said = handle.broadcast.mock.calls.map(([m]) => m[KEY]);
      expect(said.filter((m) => m === "here")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("rejoining after a reload", () => {
  async function remembered(url) {
    const { keepCall, leavingCall } = await import("../src/engine/rejoin.js");
    keepCall({ room: url, camera: false, mic: true });
    leavingCall();
  }

  test("back in it when its room is on screen again", async () => {
    const url = generateAutomergeUrl();
    await remembered(url);
    engine.hearRoom(url, { onScreen: true });
    await tick();
    await tick();
    expect(engine.call.get()?.room).toBe(url);
  });

  test("not when it's only heard (a button asking about it)", async () => {
    const url = generateAutomergeUrl();
    await remembered(url);
    engine.hearRoom(url);
    await tick();
    await tick();
    expect(engine.call.get()).toBe(null);
  });
});

describe("where faces go", () => {
  test("in the sidebar only while something can show them there", () => {
    engine.setFaces("sidebar");
    expect(engine.call.mode()).toBe("floating");
    expect(engine.call.settings.faces).toBe("floating");
    const release = engine.holdVideoSpot();
    expect(engine.call.canShowVideo()).toBe(true);
    engine.setFaces("sidebar");
    expect(engine.call.mode()).toBe("sidebar");
    release();
    expect(engine.call.canShowVideo()).toBe(false);
    expect(engine.call.mode()).toBe("floating");
    expect(engine.call.settings.faces).toBe("sidebar");
  });

  test("the video's wanted while you're in a call with faces in the sidebar", async () => {
    const release = engine.holdVideoSpot();
    engine.setFaces("sidebar");
    expect(engine.call.videoWanted()).toBe(false);
    await engine.join(generateAutomergeUrl());
    expect(engine.call.videoWanted()).toBe(true);
    release();
    expect(engine.call.videoWanted()).toBe(false);
  });

  test("on cursors isn't the call's to say any more", () => {
    expect(engine.call.cursors).toBe(undefined);
    expect(engine.setCursors).toBe(undefined);
    expect(engine.inProject).toBe(undefined);
  });
});

describe("asking", () => {
  test("asking about a room, at a place", () => {
    const url = generateAutomergeUrl();
    engine.ask(`${url}#h`, { at: { x: 1, y: 2 } });
    expect(engine.call.asking()).toEqual({ url, at: { x: 1, y: 2 } });
    engine.call.stopAsking();
    expect(engine.call.asking()).toBe(null);
  });
});
