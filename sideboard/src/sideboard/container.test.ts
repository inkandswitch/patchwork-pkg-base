import { describe, expect, it } from "vitest";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { canExpand, containerChildren } from "./container.ts";

const A = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;
const B = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;

/** patchwork-filesystem's providers, as the host provides them. */
const host = {
  providerFor: (doc: any) =>
    doc?.["@patchwork"]?.type === "directory"
      ? {
          list: () => [
            { name: "dist/index.js", link: A },
            { name: "package.json", link: B },
            { name: "inline", value: { content: "x" } },
          ],
        }
      : undefined,
};

describe("canExpand", () => {
  it("is true for directory and branches links when the host has providers", () => {
    expect(canExpand("directory", host)).toBe(true);
    expect(canExpand("branches", host)).toBe(true);
    expect(canExpand("markdown", host)).toBe(false);
    expect(canExpand("folder", host)).toBe(false); // folders have their own row
  });

  it("is false on a host without providers", () => {
    expect(canExpand("directory", {})).toBe(false);
  });
});

describe("containerChildren", () => {
  it("lists the documents a container links to, by name", () => {
    expect(containerChildren({ "@patchwork": { type: "directory" } }, host)).toEqual([
      { name: "dist/index.js", url: A },
      { name: "package.json", url: B },
    ]);
  });

  it("lists nothing for a doc no provider walks, or without providers", () => {
    expect(containerChildren({ "@patchwork": { type: "markdown" } }, host)).toEqual([]);
    expect(containerChildren({ "@patchwork": { type: "directory" } }, {})).toEqual([]);
  });
});
