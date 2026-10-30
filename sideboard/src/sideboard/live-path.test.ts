import { describe, expect, it, vi } from "vitest";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { createLivePaths, livePathsFor } from "./live-path.ts";

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

describe("createLivePaths", () => {
  it("follows the account: a list gains paths when it becomes the first at /, and loses them after", async () => {
    const { createRoot, createSignal } = await import("solid-js");
    let namespace: Record<string, Array<{ url: AutomergeUrl }>> = {};
    const acct = { documentId: account.documentId, doc: () => ({ rootFolderUrl: ROOT, namespace }) };
    const [changed, setChanged] = createSignal(0);
    await createRoot(async (dispose) => {
      const livePathOf = createLivePaths(() => OTHER, () => acct, changed, grammar);
      await vi.waitFor(() => expect(livePathOf.state).toBe("ready"));
      expect(livePathOf.latest).toBeUndefined();

      namespace = { "/": [{ url: OTHER }, { url: ROOT }] };
      setChanged(1);
      await vi.waitFor(() => expect(livePathOf.latest?.(["a"])).toBe("hash(2j9knpCseyhnK8izDmLpGP5WMdZQ)/a"));

      namespace = {};
      setChanged(2);
      await vi.waitFor(() => expect(livePathOf.latest).toBeUndefined());
      dispose();
    });
  });
});
