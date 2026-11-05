import { describe, expect, it } from "vitest";
import { generateAutomergeUrl } from "@automerge/automerge-repo/slim";

import { directoryChildren, folderChildren } from "./children.js";

describe("folderChildren", () => {
  it("lists entries with their datatypes", () => {
    const a = generateAutomergeUrl();
    const b = generateAutomergeUrl();
    const doc = {
      "@patchwork": { type: "folder" },
      docs: [
        { url: a, type: "essay", name: "A" },
        { url: b, type: "folder", name: "B" },
        { url: "not a url", type: "essay", name: "C" },
      ],
    };

    expect(folderChildren(doc)).toEqual([
      { url: a, type: "essay" },
      { url: b, type: "folder" },
    ]);
  });
});

describe("directoryChildren", () => {
  it("lists every file without a datatype", () => {
    const a = generateAutomergeUrl();
    const b = generateAutomergeUrl();
    const doc = {
      "@patchwork": { type: "directory" },
      lastSyncAt: 1,
      "README.md": a,
      "src/index.js": b,
    };

    expect(directoryChildren(doc)).toEqual([{ url: a }, { url: b }]);
  });
});
