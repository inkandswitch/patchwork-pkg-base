import { describe, expect, it } from "vitest";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { idhash, livePathsFor } from "./live-path.ts";

const ROOT = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;
const OTHER = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;
const account = {
  documentId: "2j9knpCseyhnK8izDmLpGP5WMdZQ",
  doc: () => ({ rootFolderUrl: ROOT }),
};

describe("idhash", () => {
  it("matches patchwork-filesystem's", async () => {
    expect(await idhash("2j9knpCseyhnK8izDmLpGP5WMdZQ")).toBe("vjRneszhMkDwr5tb");
  });
});

describe("livePathsFor", () => {
  it("gives the account root's rows their live path, each name encoded", async () => {
    const livePathOf = await livePathsFor(account, ROOT);
    expect(livePathOf?.(["Projects", "a/b c"])).toBe("vjRneszhMkDwr5tb/Projects/a%2Fb%20c");
  });

  it("gives any other folder no paths", async () => {
    expect(await livePathsFor(account, OTHER)).toBeUndefined();
    expect(await livePathsFor(undefined, ROOT)).toBeUndefined();
  });
});
