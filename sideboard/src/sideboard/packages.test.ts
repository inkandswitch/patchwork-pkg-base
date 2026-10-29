import { describe, expect, it } from "vitest";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { packagesFolderSuffices, packagesFolders } from "./packages.ts";

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
