import { describe, expect, it } from "vitest";
import { generateAutomergeUrl, parseAutomergeUrl } from "@automerge/automerge-repo/slim";

import { markdownChildren } from "./children";

describe("markdownChildren", () => {
  it("lists embedded docs in text order", () => {
    const a = generateAutomergeUrl();
    const b = generateAutomergeUrl();
    const idA = parseAutomergeUrl(a).documentId;
    const idB = parseAutomergeUrl(b).documentId;
    const doc = {
      content: `# Hi\n[patchwork:${idB}/embed]\ntext [patchwork:${idA}] [patchwork:nope]`,
    };

    expect(markdownChildren(doc)).toEqual([{ url: b }, { url: a }]);
  });
});
