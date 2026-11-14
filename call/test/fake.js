// a page for the engine to run in: a repo of fake docs whose ephemeral
// messages can be heard and said, no media, and nothing lasting from before
import { vi } from "vitest";

export function fakeHandle(url, doc = {}) {
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

/** a new page: returns the docs found, by url */
export function freshPage() {
  delete globalThis[Symbol.for("patchwork-call:lasting")];
  vi.resetModules();
  sessionStorage.clear();
  localStorage.clear();
  const handles = new Map();
  globalThis.repo = {
    find: vi.fn(async (url) => {
      if (!handles.has(url)) handles.set(url, fakeHandle(url));
      return handles.get(url);
    }),
  };
  vi.stubGlobal("navigator", {
    ...globalThis.navigator,
    mediaDevices: { getUserMedia: () => Promise.reject(new Error("no media here")), enumerateDevices: async () => [] },
  });
  vi.stubGlobal(
    "MediaStream",
    // (its own kind, so a <video> takes it)
    class extends (globalThis.MediaStream ?? Object) {
      tracks = [];
      getTracks = () => [...this.tracks];
      getVideoTracks = () => this.tracks.filter((t) => t.kind === "video");
      addTrack = (t) => this.tracks.push(t);
      removeTrack = (t) => (this.tracks = this.tracks.filter((x) => x !== t));
    },
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return handles;
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
export const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
};
export const here = (handle, from = "x", who = { name: "ana" }) =>
  handle.emit({ "lattice-wm:call": "here", from, who });
