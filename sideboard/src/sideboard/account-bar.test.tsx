import { afterEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo/slim";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import { AccountBar } from "./account-bar.tsx";
import type { SideboardAccountDoc } from "../types.ts";

const SETTINGS = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;
const PACKAGES = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;

/** Enough of a DocHandle for a document projection: the doc, and change events. */
function fakeHandle(doc: SideboardAccountDoc) {
  return {
    url: "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ",
    documentId: "2j9knpCseyhnK8izDmLpGP5WMdZQ",
    doc: () => doc,
    whenReady: async () => {},
    isReady: () => true,
    heads: () => [],
    on() {},
    off() {},
    addListener() {},
    removeListener() {},
  } as unknown as DocHandle<SideboardAccountDoc>;
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
});

const ID = "2j9knpCseyhnK8izDmLpGP5WMdZQ";
const settingsDocs: Record<string, object> = {
  [SETTINGS]: { modules: [`automerge:${ID}`], movedToPackages: [ID] },
};
/** What solid-automerge's useDocument asks of a Repo. */
const repo = {
  find: async (url: string) => fakeHandle(settingsDocs[url] as SideboardAccountDoc),
  findWithProgress: (url: string) => ({
    peek: () => ({ state: "ready", handle: fakeHandle(settingsDocs[url] as SideboardAccountDoc) }),
    whenReady: async () => fakeHandle(settingsDocs[url] as SideboardAccountDoc),
  }),
} as unknown as Repo;

function buttons(doc: SideboardAccountDoc, hostLoadsPackages = true) {
  const container = document.createElement("div");
  document.body.append(container);
  dispose = render(
    () => (
      <AccountBar
        handle={fakeHandle(doc)}
        repo={repo}
        hostLoadsPackages={hostLoadsPackages}
        element={container as unknown as PatchworkViewElement}
      />
    ),
    container
  );
  return [...container.querySelectorAll("button")].map((b) => b.textContent?.trim());
}

describe("AccountBar", () => {
  it("links to Packages for an account without /packages", () => {
    expect(buttons({ moduleSettingsUrl: SETTINGS })).toContain("Packages");
  });

  it("leaves Packages to the sidebar once /packages covers module settings", () => {
    expect(
      buttons({ moduleSettingsUrl: SETTINGS, namespace: { "/packages": [{ url: PACKAGES }] } })
    ).not.toContain("Packages");
  });

  it("keeps Packages on a host that doesn't load /packages", () => {
    expect(
      buttons({ moduleSettingsUrl: SETTINGS, namespace: { "/packages": [{ url: PACKAGES }] } }, false)
    ).toContain("Packages");
  });
});
