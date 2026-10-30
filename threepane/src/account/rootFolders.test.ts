import { describe, expect, it } from "vitest";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { DOCUMENT_LIST_TOOL } from "../datatypes";
import { rootFolders, sidebarWidgetsFor } from "./rootFolders";

const ROOT = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;
const A = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;
const B = "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ" as AutomergeUrl;

describe("rootFolders", () => {
  it("is what's bound at /, in order, else the root folder", () => {
    expect(rootFolders({ rootFolderUrl: ROOT, namespace: { "/": [{ url: A }, { url: B }] } })).toEqual([A, B]);
    expect(rootFolders({ rootFolderUrl: ROOT })).toEqual([ROOT]);
    expect(rootFolders({ rootFolderUrl: ROOT, namespace: { "/": [{ url: "nope" as AutomergeUrl }] } })).toEqual([ROOT]);
    expect(rootFolders(undefined)).toEqual([]);
  });
});

describe("sidebarWidgetsFor", () => {
  it("shows the root folder's list as one list per folder bound at /", () => {
    const account = { rootFolderUrl: ROOT, namespace: { "/": [{ url: A }, { url: B }] } };
    expect(sidebarWidgetsFor([[DOCUMENT_LIST_TOOL, ROOT], "some-component"], account)).toEqual([
      [DOCUMENT_LIST_TOOL, A],
      [DOCUMENT_LIST_TOOL, B],
      "some-component",
    ]);
  });

  it("leaves widgets alone while / isn't bound elsewhere", () => {
    const widgets = [[DOCUMENT_LIST_TOOL, ROOT], [DOCUMENT_LIST_TOOL, A]] as [string, AutomergeUrl][];
    expect(sidebarWidgetsFor(widgets, { rootFolderUrl: ROOT })).toEqual(widgets);
  });

  it("leaves other lists, and other tools on the root folder, alone", () => {
    const account = { rootFolderUrl: ROOT, namespace: { "/": [{ url: B }] } };
    expect(sidebarWidgetsFor([[DOCUMENT_LIST_TOOL, A], ["other/tool", ROOT]], account)).toEqual([
      [DOCUMENT_LIST_TOOL, A],
      ["other/tool", ROOT],
    ]);
  });

  it("keeps a folder's slot across calls", () => {
    const account = { rootFolderUrl: ROOT, namespace: { "/": [{ url: A }] } };
    const slots = new Map();
    const first = sidebarWidgetsFor([[DOCUMENT_LIST_TOOL, ROOT]], account, slots);
    const second = sidebarWidgetsFor([[DOCUMENT_LIST_TOOL, ROOT]], account, slots);
    expect(second[0]).toBe(first[0]);
  });
});
