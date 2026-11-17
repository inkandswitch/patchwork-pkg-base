import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { generateAutomergeUrl } from "@automerge/automerge-repo/slim";

const load = vi.fn();
vi.mock("@inkandswitch/patchwork-plugins", () => ({
  getRegistry: () => ({ load }),
}));

const { isKeyRoom, keyRoom, pageRepo, roomUrl, titleOf } = await import("../src/engine/room.js");

describe("roomUrl", () => {
  const url = generateAutomergeUrl();

  test("a doc's url is its room", () => {
    expect(roomUrl(url)).toBe(url);
  });

  test("heads and paths are the same room", () => {
    expect(roomUrl(`${url}#heads|abc`)).toBe(url);
    expect(roomUrl(`${url}/path/to`)).toBe(url);
  });

  test("anything else isn't a room", () => {
    expect(roomUrl("")).toBe(null);
    expect(roomUrl(null)).toBe(null);
    expect(roomUrl(undefined)).toBe(null);
    expect(roomUrl("https://x")).toBe(null);
    expect(roomUrl("automerge:not-a-doc")).toBe(null);
  });

  test("a key is a room, lowercased, if it's 32 bytes of hex", () => {
    expect(roomUrl("KEY:" + "AB".repeat(32))).toBe("key:" + "ab".repeat(32));
    expect(roomUrl("key:" + "a".repeat(63))).toBe(null);
    expect(roomUrl("key:" + "g".repeat(64))).toBe(null);
  });
});

describe("keyRoom", () => {
  test("32 bytes, as hex", () => {
    expect(keyRoom(new Uint8Array(32).fill(255))).toBe("key:" + "ff".repeat(32));
    expect(isKeyRoom(keyRoom(new Uint8Array(32)))).toBe(true);
    expect(isKeyRoom(generateAutomergeUrl())).toBe(false);
  });

  test("anything but 32 bytes is refused", () => {
    expect(() => keyRoom(new Uint8Array(31))).toThrow(RangeError);
  });
});

describe("pageRepo", () => {
  let saved;
  beforeEach(() => (saved = { repo: globalThis.repo, patchwork: globalThis.patchwork }));
  afterEach(() => Object.assign(globalThis, saved));

  test("the page's repo, wherever this host put it", () => {
    const repo = {};
    globalThis.repo = repo;
    expect(pageRepo()).toBe(repo);
    const other = {};
    globalThis.repo = undefined;
    globalThis.patchwork = { repo: other };
    expect(pageRepo()).toBe(other);
    globalThis.patchwork = undefined;
    expect(pageRepo()).toBe(null);
  });
});

describe("titleOf", () => {
  const handleOf = (doc) => ({ doc: () => doc });

  test("the datatype's title", async () => {
    load.mockResolvedValueOnce({ module: { getTitle: (d) => "T:" + d.x } });
    expect(await titleOf(handleOf({ "@patchwork": { type: "t" }, x: 1 }))).toBe("T:1");
    expect(load).toHaveBeenCalledWith("t");
  });

  test("its own title when the datatype can't be had, or nothing", async () => {
    load.mockRejectedValueOnce(new Error("no"));
    expect(await titleOf(handleOf({ "@patchwork": { type: "t" }, title: "mine" }))).toBe("mine");
    expect(await titleOf(handleOf({}))).toBe("");
    expect(await titleOf(handleOf(undefined))).toBe("");
  });
});
