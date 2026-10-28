import { describe, expect, it } from "vitest";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { packagesFolders } from "./packages.ts";

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
