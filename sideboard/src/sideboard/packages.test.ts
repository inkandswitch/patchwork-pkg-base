import { describe, expect, it } from "vitest";
import { ImmutableString, type AutomergeUrl } from "@automerge/automerge-repo/slim";
import { packagesFolderSuffices, packagesFolders, pinnedPackagesFolder, rootFolders } from "./packages.ts";

const A = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;
const B = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;

describe("packagesFolders", () => {
  it("is the folders bound at /packages, in order", () => {
    expect(packagesFolders({ namespace: { "/packages": [{ url: A }, { url: B }] } })).toEqual([A, B]);
  });

  it("skips bindings that aren't automerge urls", () => {
    expect(
      packagesFolders({ namespace: { "/packages": [{ url: "nope" as AutomergeUrl }, { url: A }] } })
    ).toEqual([A]);
  });

  it("is empty for an account without /packages", () => {
    expect(packagesFolders({})).toEqual([]);
    expect(packagesFolders({ namespace: { "/": [{ url: A }] } })).toEqual([]);
    expect(packagesFolders(undefined)).toEqual([]);
  });
});

describe("packagesFolderSuffices", () => {
  const ID = "2j9knpCseyhnK8izDmLpGP5WMdZQ";
  const bound = { namespace: { "/packages": [{ url: A }] } };
  const covered = { modules: [`automerge:${ID}`], movedToPackages: [ID] };

  it("is true once /packages covers module settings on a host that loads it", () => {
    expect(packagesFolderSuffices(bound, covered, true)).toBe(true);
  });

  it("is false while module settings holds something /packages doesn't", () => {
    for (const modules of [[`automerge:${ID}#abc`], ["https://x.test/a.js"], [`automerge:${ID}`, B]]) {
      expect(packagesFolderSuffices(bound, { ...covered, modules }, true)).toBe(false);
    }
    expect(packagesFolderSuffices(bound, undefined, true)).toBe(false);
  });

  it("is false without /packages, or on a host that doesn't load it", () => {
    expect(packagesFolderSuffices({}, covered, true)).toBe(false);
    expect(packagesFolderSuffices(bound, covered, false)).toBe(false);
  });
});

describe("pinnedPackagesFolder", () => {
  const ROOT = "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ" as AutomergeUrl;
  const account = (doc: object) => ({ doc: () => doc });

  it("is the first /packages folder, in the account's own root folder", () => {
    const acct = account({ rootFolderUrl: ROOT, namespace: { "/packages": [{ url: A }, { url: B }] } });
    expect(pinnedPackagesFolder(acct, ROOT)).toBe(A);
  });

  it("is in the folder bound first at /, when / is bound", () => {
    const acct = account({
      rootFolderUrl: ROOT,
      namespace: { "/": [{ url: B }], "/packages": [{ url: A }] },
    });
    expect(pinnedPackagesFolder(acct, B)).toBe(A);
    expect(pinnedPackagesFolder(acct, ROOT)).toBeUndefined();
  });

  it("is nothing in another folder, without /packages, or without an account", () => {
    expect(pinnedPackagesFolder(account({ rootFolderUrl: ROOT, namespace: { "/packages": [{ url: A }] } }), B)).toBeUndefined();
    expect(pinnedPackagesFolder(account({ rootFolderUrl: ROOT }), ROOT)).toBeUndefined();
    expect(pinnedPackagesFolder(undefined, ROOT)).toBeUndefined();
  });
});

describe("rootFolders", () => {
  const ROOT = "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ" as AutomergeUrl;

  it("is what's bound at /, in order", () => {
    expect(rootFolders({ rootFolderUrl: ROOT, namespace: { "/": [{ url: A }, { url: B }] } })).toEqual([A, B]);
  });

  it("falls back to the root folder when / binds nothing valid", () => {
    expect(rootFolders({ rootFolderUrl: ROOT })).toEqual([ROOT]);
    expect(rootFolders({ rootFolderUrl: ROOT, namespace: { "/": [] } })).toEqual([ROOT]);
    expect(rootFolders({ rootFolderUrl: ROOT, namespace: { "/": [{ url: "nope" as AutomergeUrl }] } })).toEqual([ROOT]);
    expect(rootFolders({ rootFolderUrl: ROOT, namespace: { "/": "nope" as never } })).toEqual([ROOT]);
    expect(
      rootFolders({ rootFolderUrl: ROOT, namespace: { "/": [{ url: new ImmutableString(A) as never }] } })
    ).toEqual([A]);
  });

  it("is nothing without either", () => {
    expect(rootFolders({})).toEqual([]);
    expect(rootFolders(undefined)).toEqual([]);
  });
});
