import { describe, expect, it, vi } from "vitest";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { livePathsFor } from "./live-path.ts";

const ROOT = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;
const OTHER = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;
const account = {
  documentId: "2j9knpCseyhnK8izDmLpGP5WMdZQ",
  doc: () => ({ rootFolderUrl: ROOT }),
};

/** patchwork-filesystem's path grammar, as the host provides it. */
const grammar = {
  idhash: vi.fn(async (id: string) => `hash(${id})`),
  livePath: vi.fn((acct: string, names: string[]) => [acct, ...names].join("/")),
};

describe("livePathsFor", () => {
  it("builds the account root's paths with the host's grammar", async () => {
    const livePathOf = await livePathsFor(account, ROOT, grammar);
    expect(livePathOf?.(["Projects", "foo"])).toBe("hash(2j9knpCseyhnK8izDmLpGP5WMdZQ)/Projects/foo");
    expect(grammar.livePath).toHaveBeenCalledWith("hash(2j9knpCseyhnK8izDmLpGP5WMdZQ)", ["Projects", "foo"]);
  });

  it("builds paths in the folder bound first at /, and no others", async () => {
    const rebound = {
      documentId: account.documentId,
      doc: () => ({ rootFolderUrl: ROOT, namespace: { "/": [{ url: OTHER }, { url: ROOT }] } }),
    };
    expect((await livePathsFor(rebound, OTHER, grammar))?.(["a"])).toBe("hash(2j9knpCseyhnK8izDmLpGP5WMdZQ)/a");
    expect(await livePathsFor(rebound, ROOT, grammar)).toBeUndefined();
  });

  it("gives any other folder no paths", async () => {
    expect(await livePathsFor(account, OTHER, grammar)).toBeUndefined();
    expect(await livePathsFor(undefined, ROOT, grammar)).toBeUndefined();
  });

  it("gives no paths on a system without them", async () => {
    expect(await livePathsFor(account, ROOT, {})).toBeUndefined();
  });
});
