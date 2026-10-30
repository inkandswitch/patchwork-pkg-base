import { describe, expect, it } from "vitest";
import {
  installFolderUrl,
  installsIntoFolder,
  linkPackage,
  uniqueName,
  unlinkPackage,
  type FolderHandle,
} from "./packages-folder.ts";

const MINE = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs";
const TEAM = "automerge:3tmVsDzywTYecevUsD21YABfXKon";
const PKG = "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ";
const OTHER = "automerge:3aNu5cqxaJ1vLywKRRX9kYEB8unS";

const account = (namespace?: object) => ({ doc: () => ({ namespace }) as any });

function folder(docs: { name: string; type: string; url: string }[] = []): FolderHandle {
  const doc = { title: "packages", docs };
  return { url: MINE, doc: () => doc, change: (fn) => fn(doc) };
}

describe("installFolderUrl", () => {
  it("is your packages folder: the first /packages binding", () => {
    expect(installFolderUrl(account({ "/packages": [{ url: MINE }, { url: TEAM }] }), true)).toBe(MINE);
  });

  it("is nothing without /packages, without an account, or on a host that doesn't load it", () => {
    expect(installFolderUrl(account({}), true)).toBeUndefined();
    expect(installFolderUrl(undefined, true)).toBeUndefined();
    expect(installFolderUrl(account({ "/packages": [{ url: MINE }] }), false)).toBeUndefined();
    expect(installFolderUrl(account({ "/packages": [{ url: "nope" }] }), true)).toBeUndefined();
  });
});

describe("installsIntoFolder", () => {
  it("takes an unpinned automerge url, and leaves pinned and http ones to module settings", () => {
    expect(installsIntoFolder(PKG)).toBe(true);
    expect(installsIntoFolder(`${PKG}#abc`)).toBe(false);
    expect(installsIntoFolder("https://cdn.example.test/x.js")).toBe(false);
  });
});

describe("uniqueName", () => {
  it("keeps a free name, and counts past taken ones", () => {
    expect(uniqueName("alpha", [])).toBe("alpha");
    expect(uniqueName("alpha", ["alpha", "alpha (2)"])).toBe("alpha (3)");
  });
});

describe("linkPackage", () => {
  it("links a package under a free name, once", () => {
    const f = folder([{ name: "alpha", type: "folder", url: OTHER }]);
    linkPackage(f, { url: PKG, name: "alpha", type: "directory" });
    linkPackage(f, { url: PKG, name: "alpha", type: "directory" });
    expect(f.doc()!.docs).toEqual([
      { name: "alpha", type: "folder", url: OTHER },
      { name: "alpha (2)", type: "directory", url: PKG },
    ]);
  });
});

describe("unlinkPackage", () => {
  it("removes every link to the document, and says whether it did", () => {
    const f = folder([
      { name: "a", type: "folder", url: PKG },
      { name: "b", type: "folder", url: OTHER },
      { name: "c", type: "folder", url: `${PKG}#abc` },
    ]);
    expect(unlinkPackage(f, PKG.slice("automerge:".length))).toBe(true);
    expect(f.doc()!.docs.map((d) => d.name)).toEqual(["b"]);
    expect(unlinkPackage(f, PKG.slice("automerge:".length))).toBe(false);
  });
});
