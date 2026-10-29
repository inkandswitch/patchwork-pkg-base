import { describe, expect, it } from "vitest";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { toRichText } from "@tldraw/tldraw";
import { init, type TLDrawDoc } from "./datatype.ts";
import { provider } from "./path-provider.ts";
import { splitShapeUrl } from "./shape-url.ts";

const FILE = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs";
const EMBED = "automerge:3tmVsDzywTYecevUsD21YABfXKon";

let n = 0;
function shape(id: string, type: string, props: Record<string, unknown> = {}) {
  return {
    id: `shape:${id}`,
    typeName: "shape",
    type,
    x: 0,
    y: 0,
    rotation: 0,
    index: `a${n++}`,
    parentId: "page:page",
    isLocked: false,
    opacity: 1,
    meta: {},
    props,
  };
}

function canvas(...shapes: ReturnType<typeof shape>[]) {
  const doc = { "@patchwork": { type: "tldraw5" } } as unknown as TLDrawDoc;
  init(doc);
  for (const record of shapes) (doc.store as Record<string, unknown>)[record.id] = record;
  return doc;
}

const names = (doc: unknown) => provider.list(doc).map((child) => child.name);

describe("tldraw path provider", () => {
  const doc = canvas(
    shape("aaaaaaaaHello1", "text", { richText: toRichText("Hello\nworld") }),
    shape("bbbbbbbbBox00001", "geo", { geo: "rectangle", richText: toRichText("") }),
    shape("arrow1", "arrow", { richText: toRichText("") }),
    shape("frame1", "frame", { name: "a/b frame" }),
    shape("automerge_3tmVsDzywTYecevUsD21YABfXKon", "patchwork-doc", {
      docUrl: EMBED,
      docName: "Notes",
    }),
    shape("note-long", "note", { richText: toRichText("x".repeat(80)) })
  );
  doc.docs = [{ name: "main.js", type: "file", url: FILE as never }];

  it("matches a canvas and nothing else", () => {
    expect(provider.matches(doc)).toBe(true);
    expect(provider.matches({ docs: [] })).toBe(false);
    expect(provider.matches(undefined)).toBe(false);
  });

  it("lists the linked docs, then each shape as a sub-document of its record", () => {
    const children = provider.list(doc);
    expect(children[0]).toEqual({ name: "main.js", link: FILE });
    const subs = children.slice(1);
    expect(subs).toHaveLength(6);
    for (const child of subs) {
      expect("sub" in child && child.sub[0]).toBe("store");
      const id = "sub" in child ? child.sub[1] : "";
      expect((doc.store as Record<string, { typeName: string }>)[id].typeName).toBe("shape");
    }
  });

  it("names shapes by their text, or their kind, and the tail of their id", () => {
    expect(names(doc)).toEqual([
      "main.js",
      "Hello world (aaHello1)",
      "rectangle (Box00001)",
      "arrow (arrow1)",
      "a-b frame (frame1)",
      "Notes (YABfXKon)",
      `${"x".repeat(39)}… (ote-long)`,
    ]);
  });

  it("gives names that are unique and have no slash", () => {
    const twins = canvas(
      shape("one-00000000", "text", { richText: toRichText("same") }),
      shape("two-00000000", "text", { richText: toRichText("same") }),
      shape("c", "text", { richText: toRichText("slash/y") })
    );
    const all = names(twins);
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((name) => !name.includes("/"))).toBe(true);
    expect(all).toContain("same (one-00000000)");
    expect(all).toContain("same (two-00000000)");
  });

  it("looks up each name it lists, using one name", () => {
    for (const child of provider.list(doc)) {
      expect(provider.lookup(doc, [child.name, "more"])).toEqual({ child, consumed: 1 });
    }
  });

  it("finds nothing under a name it doesn't list", () => {
    expect(provider.lookup(doc, ["nope"])).toBeUndefined();
    expect(provider.lookup(doc, ["Hello world"])).toBeUndefined();
  });

  it("lists a canvas without shapes or docs as empty", () => {
    expect(provider.list(canvas())).toEqual([]);
  });
});

describe("splitShapeUrl", () => {
  const id = "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ" as AutomergeUrl;
  const at = (url: string) => url as AutomergeUrl;

  it("leaves a canvas url alone", () => {
    expect(splitShapeUrl(id)).toEqual({ docUrl: id });
    expect(splitShapeUrl(at(`${id}#abc|def`))).toEqual({ docUrl: `${id}#abc|def` });
  });

  it("splits a shape's sub-document url into the canvas and the shape", () => {
    expect(splitShapeUrl(at(`${id}/store/shape%3Aabc`))).toEqual({
      docUrl: id,
      shapeId: "shape:abc",
    });
    expect(splitShapeUrl(at(`${id}/store/shape%3Aabc#h1`))).toEqual({
      docUrl: `${id}#h1`,
      shapeId: "shape:abc",
    });
  });

  it("shows the canvas for any other path into it", () => {
    expect(splitShapeUrl(at(`${id}/store/page%3Apage`))).toEqual({ docUrl: id });
    expect(splitShapeUrl(at(`${id}/docs/@0`))).toEqual({ docUrl: id });
  });
});
