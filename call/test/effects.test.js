import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { generateAutomergeUrl } from "@automerge/automerge-repo/slim";
import { freshPage, settle } from "./fake.js";

const ENTRY = "https://patchwork.test/modules/cats/index.js";
const effect = (extra = {}) => ({
  type: "patchwork:call-effect",
  id: "cat-ears",
  name: "Cat ears",
  icon: "Cat",
  kind: "overlay",
  needs: ["landmarks"],
  effect: "./effect.js",
  load: async () => ({}),
  ...extra,
});

let handles, effects, plugins;
beforeEach(async () => {
  handles = freshPage();
  effects = await import("../src/engine/effects.js");
  plugins = await import("@inkandswitch/patchwork-plugins");
});
afterEach(() => {
  plugins.getRegistry("patchwork:call-effect").all().forEach((p) => plugins.getRegistry("patchwork:call-effect").remove(p.id));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("what an effect is", () => {
  test("its module's url is found from where its package was loaded", () => {
    const found = effects.described({ ...effect(), importUrl: ENTRY });
    expect(found).toEqual({
      id: "cat-ears",
      name: "Cat ears",
      icon: "Cat",
      kind: "overlay",
      needs: ["landmarks"],
      url: "https://patchwork.test/modules/cats/effect.js",
    });
  });

  test("a plugin without a module to draw with isn't one", () => {
    expect(effects.described({ ...effect(), effect: undefined, importUrl: ENTRY })).toBeNull();
    expect(effects.described(null)).toBeNull();
  });

  test("a url that can't be made isn't one either", () => {
    expect(effects.described({ ...effect(), importUrl: undefined })).toBeNull();
  });

  test("what it says it needs is only what there is, and its kind's one there is", () => {
    const found = effects.described({ ...effect({ kind: "weird", needs: ["landmarks", "feet", "mask"] }), importUrl: ENTRY });
    expect(found.kind).toBe("overlay");
    expect(found.needs).toEqual(["landmarks", "mask"]);
  });

  test("with nothing said, it needs nothing", () => {
    expect(effects.described({ ...effect({ needs: undefined }), importUrl: ENTRY }).needs).toEqual([]);
  });
});

describe("finding them in the registry", () => {
  test("any package's, by id, and listed", async () => {
    plugins.registerPlugins([effect(), effect({ id: "hat", name: "Hat" })], ENTRY);
    expect((await effects.list()).map((e) => e.id).sort()).toEqual(["cat-ears", "hat"]);
    expect((await effects.find("hat")).url).toBe("https://patchwork.test/modules/cats/effect.js");
  });

  test("one that's gone isn't found", async () => {
    expect(await effects.find("nope")).toBeNull();
  });

  test("watching hears them now, and as they come and go", async () => {
    const heard = vi.fn();
    const stop = effects.watch(heard);
    await settle();
    expect(heard).toHaveBeenLastCalledWith([]);
    plugins.registerPlugins([effect()], ENTRY);
    expect(heard.mock.lastCall[0].map((e) => e.id)).toEqual(["cat-ears"]);
    stop();
    heard.mockClear();
    plugins.unregisterPlugins(ENTRY);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("support", () => {
  test("where there's no processor, there are no effects", () => {
    expect(effects.supported()).toBe(false);
  });
});

// a pipeline with fake streams, and a worker that remembers what it's told
function fakeMedia() {
  const workers = [];
  class Worker {
    posted = [];
    terminated = false;
    constructor(url) {
      this.url = url;
      workers.push(this);
    }
    postMessage(message, transfer) {
      this.posted.push(message);
    }
    terminate() {
      this.terminated = true;
    }
  }
  class Processor {
    constructor({ track }) {
      this.track = track;
      this.readable = { from: track };
    }
  }
  class Generator {
    kind = "video";
    stopped = false;
    constructor({ kind }) {
      this.kind = kind;
      this.writable = {};
    }
    stop() {
      this.stopped = true;
    }
  }
  vi.stubGlobal("Worker", Worker);
  vi.stubGlobal("MediaStreamTrackProcessor", Processor);
  vi.stubGlobal("MediaStreamTrackGenerator", Generator);
  vi.stubGlobal("OffscreenCanvas", class {});
  return workers;
}

const camera = () => ({ kind: "video", stopped: false, stop() { this.stopped = true; } });
const found = { id: "cat-ears", name: "Cat ears", icon: "", kind: "overlay", needs: [], url: "https://x.test/effect.js" };

describe("the pipeline", () => {
  test("it's there where the browser has it", () => {
    fakeMedia();
    expect(effects.supported()).toBe(true);
  });

  test("the worker gets the camera's pictures and the effect to draw", () => {
    const [workers, raw] = [fakeMedia(), camera()];
    const track = effects.processed(raw, found);
    const [worker] = workers;
    expect(worker.posted[0].type).toBe("start");
    expect(worker.posted[0].readable.from).toBe(raw);
    expect(worker.posted[1]).toEqual({ type: "effect", id: "cat-ears", url: "https://x.test/effect.js", needs: [] });
    expect(track.source).toBe(raw);
  });

  test("another effect is another message, on the same track", () => {
    const workers = fakeMedia();
    const track = effects.processed(camera(), found);
    track.setEffect({ ...found, id: "hat", url: "https://x.test/hat.js" });
    track.setEffect(null);
    expect(workers[0].posted.slice(2)).toEqual([
      { type: "effect", id: "hat", url: "https://x.test/hat.js", needs: [] },
      { type: "effect", id: null, url: null },
    ]);
  });

  test("stopping it lets go of the camera and the worker", () => {
    const workers = fakeMedia();
    const raw = camera();
    const track = effects.processed(raw, found);
    track.stop();
    expect(raw.stopped).toBe(true);
    expect(track.stopped).toBe(true);
    expect(workers[0].terminated).toBe(true);
  });

  test("a worker that says something's wrong is passed on", () => {
    const workers = fakeMedia();
    const onProblem = vi.fn();
    effects.processed(camera(), found, { onProblem });
    workers[0].onmessage({ data: { type: "problem", text: "it broke", drop: true } });
    workers[0].onmessage({ data: { type: "slow" } });
    expect(onProblem).toHaveBeenNthCalledWith(1, "it broke", { drop: true });
    expect(onProblem.mock.calls[1][1]).toEqual({ drop: true });
  });

  test("nothing's heard once it's stopped", () => {
    const workers = fakeMedia();
    const onProblem = vi.fn();
    const track = effects.processed(camera(), found, { onProblem });
    track.stop();
    workers[0].onmessage({ data: { type: "problem", text: "late" } });
    expect(onProblem).not.toHaveBeenCalled();
  });

  test("with no processor it can't start, and the worker's not left running", () => {
    const workers = fakeMedia();
    vi.stubGlobal("MediaStreamTrackProcessor", class { constructor() { throw new Error("no"); } });
    expect(() => effects.processed(camera(), found)).toThrow();
    expect(workers[0].terminated).toBe(true);
  });
});

describe("in a call", () => {
  let engine, workers, room;
  const track = (kind) => ({ kind, enabled: true, stopped: false, stop() { this.stopped = true; } });
  const cameras = [];

  beforeEach(async () => {
    workers = fakeMedia();
    cameras.length = 0;
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      mediaDevices: {
        getUserMedia: async (wants) => {
          const t = track(wants.video ? "video" : "audio");
          if (wants.video) cameras.push(t);
          return { getTracks: () => [t] };
        },
        enumerateDevices: async () => [],
      },
    });
    engine = await import("../src/engine/call.js");
    plugins = await import("@inkandswitch/patchwork-plugins");
    plugins.registerPlugins([effect({ needs: [] })], ENTRY);
    room = generateAutomergeUrl();
  });
  afterEach(() => engine.hangUp());

  const sentVideo = () => engine.call.get() && engine.call.local?.().getVideoTracks()[0];

  test("with effects off, the camera's what goes out, and no worker's made", async () => {
    await engine.join(room, { video: true });
    await settle();
    expect(workers).toHaveLength(0);
    expect(engine.call.settings.effect).toBe("off");
    expect(sentVideo()).toBe(cameras[0]);
  });

  test("choosing one in a call swaps the camera for the drawn-on track", async () => {
    await engine.join(room, { video: true });
    await settle();
    await engine.setEffect("cat-ears");
    await settle();
    expect(workers).toHaveLength(1);
    const now = sentVideo();
    expect(now.source).toBe(cameras.at(-1));
    expect(cameras[0].stopped).toBe(true);
  });

  test("another one's no new track", async () => {
    plugins.registerPlugins([effect({ needs: [] }), effect({ id: "hat", name: "Hat", needs: [] })], ENTRY);
    await engine.join(room, { video: true });
    await engine.setEffect("cat-ears");
    await settle();
    const before = sentVideo();
    await engine.setEffect("hat");
    await settle();
    expect(sentVideo()).toBe(before);
    expect(workers[0].posted.at(-1).id).toBe("hat");
  });

  test("off again gives back the plain camera", async () => {
    await engine.join(room, { video: true });
    await engine.setEffect("cat-ears");
    await settle();
    const drawn = sentVideo();
    await engine.setEffect("off");
    await settle();
    expect(drawn.stopped).toBe(true);
    expect(workers[0].terminated).toBe(true);
    expect(sentVideo().source).toBeUndefined();
    expect(sentVideo()).toBe(cameras.at(-1));
  });

  test("the choice is kept, and used when the camera's next on", async () => {
    await engine.setEffect("cat-ears");
    expect(JSON.parse(localStorage.getItem("patchwork-call:settings")).effect).toBe("cat-ears");
    await engine.join(room, { video: true });
    await settle();
    expect(sentVideo().source).toBe(cameras[0]);
  });

  test("one that's gone from the registry is no effect", async () => {
    await engine.setEffect("vanished");
    await engine.join(room, { video: true });
    await settle();
    expect(workers).toHaveLength(0);
    expect(sentVideo()).toBe(cameras[0]);
  });

  test("an effect that fails is dropped, and the camera comes back", async () => {
    await engine.join(room, { video: true });
    await engine.setEffect("cat-ears");
    await settle();
    workers[0].onmessage({ data: { type: "problem", text: "the effect broke", drop: true } });
    await settle();
    expect(engine.call.settings.effect).toBe("off");
    expect(engine.call.get().problem).toBe("the effect broke");
    expect(sentVideo().source).toBeUndefined();
  });

  test("chosen before its package has loaded (a reload, rejoining), it goes on once it's there", async () => {
    await engine.setEffect("late");
    await engine.join(room, { video: true });
    await settle();
    expect(workers).toHaveLength(0);
    expect(engine.call.effectOn()).toBe(false);
    plugins.registerPlugins([effect({ id: "late", needs: [] })], ENTRY);
    await settle();
    expect(workers).toHaveLength(1);
    expect(sentVideo().source).toBe(cameras.at(-1));
    expect(engine.call.effectOn()).toBe(true);
  });

  test("choosing the one that's chosen, while it isn't on, puts it on", async () => {
    vi.stubGlobal("MediaStreamTrackProcessor", undefined);
    await engine.setEffect("cat-ears");
    await engine.join(room, { video: true });
    await settle();
    expect(engine.call.effectOn()).toBe(false);
    fakeMedia();
    await engine.setEffect("cat-ears");
    await settle();
    expect(engine.call.effectOn()).toBe(true);
  });

  test("a package turning up doesn't take the camera again while the effect's on", async () => {
    await engine.setEffect("cat-ears");
    await engine.join(room, { video: true });
    await settle();
    const before = cameras.length;
    plugins.registerPlugins([effect({ id: "hat", needs: [] })], ENTRY);
    await settle();
    expect(cameras.length).toBe(before);
    expect(workers).toHaveLength(1);
  });

  test("in a browser without them, the choice is as good as off", async () => {
    vi.stubGlobal("MediaStreamTrackProcessor", undefined);
    await engine.setEffect("cat-ears");
    await engine.join(room, { video: true });
    await settle();
    expect(sentVideo().source).toBeUndefined();
  });
});
