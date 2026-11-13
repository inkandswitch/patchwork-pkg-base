import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { generateAutomergeUrl } from "@automerge/automerge-repo/slim";
import { openChannel } from "../src/engine/channel.js";

function fakeHandle(url) {
  const listeners = new Set();
  return {
    url,
    broadcast: vi.fn(),
    on: (name, fn) => name === "ephemeral-message" && listeners.add(fn),
    off: (name, fn) => listeners.delete(fn),
    emit: (event) => listeners.forEach((fn) => fn(event)),
    listeners,
  };
}

let saved;
beforeEach(() => (saved = globalThis.repo));
afterEach(() => (globalThis.repo = saved));

test("a doc's channel is its handle's ephemeral messages", async () => {
  const url = generateAutomergeUrl();
  const handle = fakeHandle(url);
  globalThis.repo = { find: vi.fn(async () => handle) };
  const channel = await openChannel(url);
  expect(channel.id).toBe(url);
  channel.send({ a: 1 });
  expect(handle.broadcast).toHaveBeenCalledWith({ a: 1 });
  const heard = vi.fn();
  channel.on(heard);
  handle.emit({ message: { b: 2 }, senderId: 7, handle });
  expect(heard).toHaveBeenCalledWith({ message: { b: 2 }, senderId: "7" });
  channel.off(heard);
  expect(handle.listeners.size).toBe(0);
});

test("a doc's channel is found once", async () => {
  const url = generateAutomergeUrl();
  globalThis.repo = { find: vi.fn(async () => fakeHandle(url)) };
  expect(await openChannel(url)).toBe(await openChannel(url));
  expect(globalThis.repo.find).toHaveBeenCalledTimes(1);
});

test("a key's channel isn't there yet", async () => {
  globalThis.repo = { find: vi.fn() };
  expect(await openChannel("key:" + "00".repeat(32))).toBe(null);
  expect(globalThis.repo.find).not.toHaveBeenCalled();
});

test("no repo, or a doc that can't be found, is no channel", async () => {
  globalThis.repo = undefined;
  expect(await openChannel(generateAutomergeUrl())).toBe(null);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const url = generateAutomergeUrl();
  globalThis.repo = { find: vi.fn(async () => Promise.reject(new Error("unavailable"))) };
  expect(await openChannel(url)).toBe(null);
  expect(warn).toHaveBeenCalled();
  // and it's tried again next time, not remembered as missing
  globalThis.repo.find = vi.fn(async () => fakeHandle(url));
  expect(await openChannel(url)).not.toBe(null);
  warn.mockRestore();
});
