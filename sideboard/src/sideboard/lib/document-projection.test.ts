import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { unwrap } from "solid-js/store";
import type {
  DocHandle,
  DocHandleChangePayload,
  Patch,
} from "@automerge/automerge-repo/slim";
import { makeDocumentProjection } from "./document-projection.ts";

type FolderDoc = {
  title: string;
  docs: { url: string; name: string; type: string }[];
};

// The patches automerge emits for `folder.docs.push({name, type, url})`.
const insertPatches: Patch[] = [
  { action: "insert", path: ["docs", 0], values: [{}] },
  { action: "put", path: ["docs", 0, "name"], value: "" },
  { action: "put", path: ["docs", 0, "type"], value: "" },
  { action: "put", path: ["docs", 0, "url"], value: "" },
  { action: "splice", path: ["docs", 0, "name", 0], value: "Untitled" },
  { action: "splice", path: ["docs", 0, "type", 0], value: "markdown" },
  { action: "splice", path: ["docs", 0, "url", 0], value: "automerge:abc" },
];

describe("makeDocumentProjection", () => {
  it("applies a change once per projection even when handles share a doc object", () => {
    // Several handle objects for the same document all hand out the same
    // materialized doc — as overlay handles from different <patchwork-view>s do.
    const document = createFakeDocument<FolderDoc>({ title: "f", docs: [] });
    const handles = [document.handle(), document.handle(), document.handle()];

    createRoot((dispose) => {
      const stores = handles.map((h) => makeDocumentProjection(h));

      document.change(insertPatches, { title: "f", docs: [{ name: "Untitled", type: "markdown", url: "automerge:abc" }] });

      for (const store of stores) {
        expect(store.docs.map((d) => d.url)).toEqual(["automerge:abc"]);
      }
      expect(document.doc().docs).toHaveLength(1);
      dispose();
    });
  });

  it("never writes into the automerge document's own object", () => {
    const document = createFakeDocument<FolderDoc>({ title: "f", docs: [] });
    const raw = document.doc();

    createRoot((dispose) => {
      const store = makeDocumentProjection(document.handle());
      expect(unwrap(store)).not.toBe(raw);

      document.change(insertPatches, { title: "f", docs: [{ name: "Untitled", type: "markdown", url: "automerge:abc" }] });

      expect(store.docs).toHaveLength(1);
      expect(raw.docs).toHaveLength(0);
      dispose();
    });
  });

  it("shares one store between projections of the same handle and tears it down last", () => {
    const document = createFakeDocument<FolderDoc>({ title: "f", docs: [] });
    const handle = document.handle();

    const disposeA = createRoot((dispose) => {
      makeDocumentProjection(handle);
      return dispose;
    });
    let storeB!: FolderDoc;
    const disposeB = createRoot((dispose) => {
      storeB = makeDocumentProjection(handle);
      return dispose;
    });

    expect(document.listenerCount()).toBe(1);
    disposeA();
    expect(document.listenerCount()).toBe(1);

    document.change(insertPatches, { title: "f", docs: [{ name: "Untitled", type: "markdown", url: "automerge:abc" }] });
    expect(storeB.docs).toHaveLength(1);

    disposeB();
    expect(document.listenerCount()).toBe(0);
  });
});

// A stand-in for an automerge document that several handles point at: every
// handle's `doc()` returns the same object, and a change fans out to every
// handle's listeners with the same patches — the shape of the real thing.
function createFakeDocument<T extends object>(initial: T) {
  let current: T = initial;
  const listeners = new Set<{ event: string; fn: (p: unknown) => void }>();

  function handle(): DocHandle<T> {
    const self = {
      url: "automerge:fake",
      doc: () => current,
      on(event: string, fn: (p: unknown) => void) {
        listeners.add({ event, fn });
        return self;
      },
      off(event: string, fn: (p: unknown) => void) {
        for (const l of listeners) {
          if (l.event === event && l.fn === fn) listeners.delete(l);
        }
        return self;
      },
    };
    return self as unknown as DocHandle<T>;
  }

  function change(patches: Patch[], after: T) {
    const before = current;
    current = after;
    for (const l of [...listeners]) {
      if (l.event !== "change") continue;
      l.fn({
        handle: undefined,
        doc: after,
        patches,
        patchInfo: { before, after, source: "change" },
      } satisfies Partial<DocHandleChangePayload<T>>);
    }
  }

  return {
    handle,
    change,
    doc: () => current,
    listenerCount: () =>
      [...listeners].filter((l) => l.event === "change").length,
  };
}
