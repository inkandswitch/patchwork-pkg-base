import { describe, expect, it } from "vitest";
import { containerOfPart, selectionKey } from "./selection.ts";

const DOC = "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ";

describe("selectionKey", () => {
  it("is one key for every spelling of a part of a document", () => {
    expect(selectionKey(`${DOC}/store/shape%3Aabc`)).toBe(selectionKey(`${DOC}/store/shape:abc`));
  });

  it("keeps heads, and leaves a whole document as it is", () => {
    expect(selectionKey(`${DOC}#h1`)).toBe(`${DOC}#h1`);
    expect(selectionKey(DOC)).toBe(DOC);
    expect(selectionKey(`${DOC}/store/shape%3Aabc#h1`)).toBe(`${DOC}/store/shape:abc#h1`);
  });

  it("survives an escape it can't decode", () => {
    expect(selectionKey(`${DOC}/bad%E0`)).toBe(`${DOC}/bad%E0`);
  });
});

describe("containerOfPart", () => {
  it("is the document a part belongs to, and nothing for a whole document", () => {
    expect(containerOfPart(`${DOC}/store/shape%3Aabc#h1`)).toBe(DOC);
    expect(containerOfPart(DOC)).toBeUndefined();
    expect(containerOfPart("https://x.test/a")).toBeUndefined();
  });
});
