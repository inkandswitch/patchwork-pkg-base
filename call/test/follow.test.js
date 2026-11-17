import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { generateAutomergeUrl } from "@automerge/automerge-repo/slim";
import { freshPage, tick } from "./fake.js";

const KEY = "lattice-wm:call";

let engine, follow, handles, url, handle;
beforeEach(async () => {
  handles = freshPage();
  engine = await import("../src/engine/call.js");
  follow = await import("../src/engine/follow.js");
  url = generateAutomergeUrl();
  await engine.join(url);
  handle = handles.get(url);
});

afterEach(() => {
  engine.hangUp();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const doc = generateAutomergeUrl();
const view = (state = {}, at = doc) => ({ url: at, toolId: "file", state });
// (ids that sort after any uuid: they offer, so nothing's connected here)
const here = (from, { contact = "", views = { main: view() }, following = null } = {}) =>
  handle.emit({ [KEY]: "here", from, who: { name: from, contact }, views, following });
const said = (kind) => handle.broadcast.mock.calls.map(([m]) => m).filter((m) => m[KEY] === kind);

describe("saying what's yours", () => {
  test("what's in a place goes to the call, soon, and in what's said of you", async () => {
    follow.shareView("main", view({ top: 3 }));
    await new Promise((resolve) => setTimeout(resolve, follow.SHARE_EVERY + 10));
    expect(said("views").at(-1).views).toEqual({ main: view({ top: 3 }) });
    handle.broadcast.mockClear();
    handle.emit({ [KEY]: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(said("here").at(-1).views).toEqual({ main: view({ top: 3 }) });
  });

  test("what isn't a view isn't said", async () => {
    follow.shareView("main", { url: "nowhere", state: {} });
    follow.shareView("other", null);
    await new Promise((resolve) => setTimeout(resolve, follow.SHARE_EVERY + 10));
    expect(said("views")).toEqual([]);
  });

  test("while you follow someone, nothing of yours: only who it is", async () => {
    follow.shareView("main", view({ top: 3 }));
    here("x");
    follow.follow("x");
    expect(said("views").at(-1)).toMatchObject({ views: {}, following: "x" });
    follow.shareView("main", view({ top: 9 }));
    await new Promise((resolve) => setTimeout(resolve, follow.SHARE_EVERY + 10));
    expect(said("views").at(-1)).toMatchObject({ views: {}, following: "x" });
    // stopping, yours again
    follow.follow("x");
    expect(said("views").at(-1)).toMatchObject({ views: { main: view({ top: 9 }) }, following: null });
  });
});

describe("following", () => {
  test("someone with a view in a place you have can be followed, and what they've open there is theirs", () => {
    here("x");
    expect(follow.canFollow("x")).toBe(false);
    const release = follow.holdArea("main");
    expect(follow.canFollow("x")).toBe(true);
    follow.follow("x");
    expect(follow.following()).toBe("x");
    expect(follow.leaderView("main")).toEqual(view());
    handle.emit({ [KEY]: "views", from: "x", views: { main: view({ top: 7 }) }, following: null });
    expect(follow.leaderView("main")).toEqual(view({ top: 7 }));
    release();
    expect(follow.canFollow("x")).toBe(false);
  });

  test("followed again, you stop", () => {
    here("x");
    follow.follow("x");
    follow.follow("x");
    expect(follow.following()).toBe(null);
  });

  test("whoever you follow following someone else, you stop", () => {
    here("x");
    follow.follow("x");
    here("x", { following: "y" });
    expect(follow.following()).toBe(null);
  });

  test("gone, they're waited for, and back as another tab of theirs it's that one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const contact = generateAutomergeUrl();
    here("x", { contact, views: { main: view({ top: 1 }) } });
    follow.follow("x");
    handle.emit({ [KEY]: "bye", from: "x" });
    expect(follow.following()).toBe("x");
    // still where they were
    expect(follow.leaderView("main")).toEqual(view({ top: 1 }));
    here("y", { contact, views: { main: view({ top: 2 }) } });
    expect(follow.following()).toBe("y");
    expect(follow.leaderView("main")).toEqual(view({ top: 2 }));
    vi.advanceTimersByTime(follow.FOLLOW_GRACE + 10);
    expect(follow.following()).toBe("y");
  });

  test("gone and not back in time, you stop", () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    here("x", { contact: generateAutomergeUrl() });
    follow.follow("x");
    handle.emit({ [KEY]: "bye", from: "x" });
    vi.advanceTimersByTime(follow.FOLLOW_GRACE + 10);
    expect(follow.following()).toBe(null);
  });

  test("hanging up, nobody's followed", async () => {
    here("x");
    follow.follow("x");
    engine.hangUp();
    await tick();
    expect(follow.following()).toBe(null);
    expect(follow.leaderView("main")).toBe(null);
  });
});
