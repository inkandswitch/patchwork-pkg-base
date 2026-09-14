import { describe, expect, it } from "vitest";

import { applyTLStoreChangesToAutomerge } from "./TLStoreToAutomerge.ts";

describe("applyTLStoreChangesToAutomerge", () => {
  it("updates nullable nested objects without throwing", () => {
    const before = {
      id: "shape:1",
      typeName: "shape",
      props: { crop: null, w: 100, h: 100 },
    };
    const after = {
      ...before,
      props: {
        ...before.props,
        crop: {
          topLeft: { x: 0.1, y: 0.2 },
          bottomRight: { x: 0.9, y: 0.8 },
        },
      },
    };
    const doc = { store: { [before.id]: structuredClone(before) } };

    applyTLStoreChangesToAutomerge(doc as any, {
      added: {},
      updated: { [before.id]: [before, after] },
      removed: {},
    } as any);

    expect(doc.store[before.id]).toEqual(after);
  });

  it("replaces nested containers when their type changes", () => {
    const before = {
      id: "shape:1",
      typeName: "shape",
      meta: { handles: null },
    };
    const after = {
      ...before,
      meta: { handles: [{ id: "a" }, { id: "b" }] },
    };
    const doc = { store: { [before.id]: structuredClone(before) } };

    applyTLStoreChangesToAutomerge(doc as any, {
      added: {},
      updated: { [before.id]: [before, after] },
      removed: {},
    } as any);

    expect(doc.store[before.id]).toEqual(after);
  });
});
