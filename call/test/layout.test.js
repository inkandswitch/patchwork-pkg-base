import { describe, expect, test, vi } from "vitest";
import { generateAutomergeUrl } from "@automerge/automerge-repo/slim";
import { createLayout, layoutFrom, lowest, mergeSpots, spotFrom, spotKey } from "../src/engine/layout.js";

// a repo of plain-object docs, shared by every "tab" in a test
function world() {
  const docs = new Map();
  const make = (url, doc) => {
    const listeners = new Set();
    const handle = {
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
    docs.set(url, handle);
    return handle;
  };
  const tab = () => ({
    find: vi.fn(async (url) => docs.get(url)),
    create: vi.fn((doc) => make(generateAutomergeUrl(), structuredClone(doc))),
  });
  return { docs, tab };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const spot = (x) => ({ x, y: 0, size: 100 });

describe("pure parts", () => {
  test("lowest of two, either missing", () => {
    expect(lowest("b", "a")).toBe("a");
    expect(lowest("a", "b")).toBe("a");
    expect(lowest(null, "b")).toBe("b");
    expect(lowest(null, null)).toBe(null);
  });
  test("a spot is made safe", () => {
    expect(spotFrom({ x: 1, y: 2, size: 10 })).toEqual({ x: 1, y: 2, size: 24 });
    expect(spotFrom({ x: 1, y: 2, size: 1e9 }).size).toBe(4000);
    expect(spotFrom({ x: "1", y: 2, size: 50 })).toBe(null);
    expect(spotFrom(null)).toBe(null);
  });
  test("a layout url must be an automerge url", () => {
    expect(layoutFrom("nope")).toBe(null);
    const url = generateAutomergeUrl();
    expect(layoutFrom(url)).toBe(url);
  });
  test("keys are per room and person", () => {
    expect(spotKey("automerge:r", "automerge:p")).toBe("automerge:r|automerge:p");
  });
});

describe("making one", () => {
  test("nobody makes one till they need one", () => {
    const { tab } = world();
    const repo = tab();
    createLayout({ repo });
    expect(repo.create).not.toHaveBeenCalled();
  });

  test("placing makes it, says its url, and reads back", async () => {
    const { tab } = world();
    const onUrl = vi.fn();
    const layout = createLayout({ repo: tab(), onUrl });
    await layout.set({ "r|p": spot(1) });
    expect(layout.url()).toMatch(/^automerge:/);
    expect(onUrl).toHaveBeenCalledTimes(1);
    expect(layout.spots()).toEqual({ "r|p": spot(1) });
    await layout.set({ "r|p": null });
    expect(layout.spots()).toEqual({});
    expect(onUrl).toHaveBeenCalledTimes(1);
  });

  test("a spot that isn't one writes nothing", async () => {
    const { tab } = world();
    const layout = createLayout({ repo: tab() });
    await layout.set({ "r|p": { x: NaN, y: 0, size: 5 } });
    expect(layout.url()).toBe(null);
  });
});

describe("agreeing", () => {
  test("a late joiner takes the one it hears", async () => {
    const { tab } = world();
    const ana = createLayout({ repo: tab() });
    await ana.set({ "r|ana": spot(1) });
    const bo = createLayout({ repo: tab() });
    await bo.hear(ana.url());
    expect(bo.url()).toBe(ana.url());
    expect(bo.spots()).toEqual({ "r|ana": spot(1) });
  });

  test("two made at once end up as one, with everything written", async () => {
    const { tab } = world();
    const ana = createLayout({ repo: tab() });
    const bo = createLayout({ repo: tab() });
    await Promise.all([ana.set({ "r|ana": spot(1) }), bo.set({ "r|bo": spot(2) })]);
    expect(ana.url()).not.toBe(bo.url());
    // they hear each other
    await Promise.all([ana.hear(bo.url()), bo.hear(ana.url())]);
    expect(ana.url()).toBe(bo.url());
    expect(ana.url()).toBe(lowest(ana.url(), bo.url()));
    const both = { "r|ana": spot(1), "r|bo": spot(2) };
    expect(ana.spots()).toEqual(both);
    expect(bo.spots()).toEqual(both);
  });

  test("a third who heard the higher one first moves on to the lower", async () => {
    const { tab } = world();
    const a = createLayout({ repo: tab() });
    const b = createLayout({ repo: tab() });
    await a.set({ "r|a": spot(1) });
    await b.set({ "r|b": spot(2) });
    const [low, high] = a.url() < b.url() ? [a, b] : [b, a];
    const cy = createLayout({ repo: tab() });
    await cy.hear(high.url());
    expect(cy.url()).toBe(high.url());
    await cy.hear(low.url());
    expect(cy.url()).toBe(low.url());
    expect(Object.keys(cy.spots()).sort()).toEqual(["r|a", "r|b"]);
    // and a higher one heard after is ignored
    await cy.hear(high.url());
    expect(cy.url()).toBe(low.url());
  });

  test("a lower one found while a higher is being found wins", async () => {
    const { docs, tab } = world();
    const a = createLayout({ repo: tab() });
    const b = createLayout({ repo: tab() });
    await a.set({ "r|a": spot(1) });
    await b.set({ "r|b": spot(2) });
    const [low, high] = [a, b].sort((x, y) => (x.url() < y.url() ? -1 : 1));
    const repo = tab();
    // the higher is slow to find
    let release;
    const slow = new Promise((resolve) => (release = resolve));
    const find = repo.find;
    repo.find = vi.fn(async (url) => {
      if (url === high.url()) await slow;
      return find(url);
    });
    const cy = createLayout({ repo });
    const first = cy.hear(high.url());
    const second = cy.hear(low.url());
    await second;
    release();
    await first;
    expect(cy.url()).toBe(low.url());
    expect(docs.size).toBe(2);
  });

  test("the same url again does nothing", async () => {
    const { tab } = world();
    const ana = createLayout({ repo: tab() });
    await ana.set({ "r|ana": spot(1) });
    const repo = tab();
    const bo = createLayout({ repo });
    await bo.hear(ana.url());
    await bo.hear(ana.url());
    expect(bo.url()).toBe(ana.url());
    expect(repo.find).toHaveBeenCalledTimes(1);
  });

  test("not a url is ignored", async () => {
    const { tab } = world();
    const layout = createLayout({ repo: tab() });
    await layout.hear("hello");
    expect(layout.url()).toBe(null);
  });

  test("a doc that can't be found leaves things as they were", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = { find: vi.fn(async () => Promise.reject(new Error("no"))), create: vi.fn() };
    const layout = createLayout({ repo });
    await layout.hear(generateAutomergeUrl());
    expect(layout.url()).toBe(null);
  });

  test("a place made while one is being found goes into that one", async () => {
    const { tab } = world();
    const ana = createLayout({ repo: tab() });
    await ana.set({ "r|ana": spot(1) });
    const bo = createLayout({ repo: tab() });
    bo.hear(ana.url());
    await bo.set({ "r|bo": spot(2) });
    expect(bo.url()).toBe(ana.url());
    expect(Object.keys(bo.spots()).sort()).toEqual(["r|ana", "r|bo"]);
  });

  test("closed, it hears nothing and stops watching", async () => {
    const { docs, tab } = world();
    const layout = createLayout({ repo: tab() });
    await layout.set({ "r|p": spot(1) });
    layout.close();
    expect(docs.get(layout.url()).listeners.size).toBe(0);
    await layout.hear(generateAutomergeUrl());
    expect(await layout.ensure()).toBe(null);
  });
});

describe("merging", () => {
  test("the doc adopted wins where both have a spot", () => {
    const mk = (spots) => {
      const doc = { spots };
      return { doc: () => doc, change: (fn) => fn(doc) };
    };
    const from = mk({ a: spot(1), b: spot(1) });
    const into = mk({ b: spot(9) });
    mergeSpots(from, into);
    expect(into.doc().spots).toEqual({ a: spot(1), b: spot(9) });
  });
});
