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

function buttons(doc: SideboardAccountDoc) {
  const container = document.createElement("div");
  document.body.append(container);
  dispose = render(
    () => (
      <AccountBar
        handle={fakeHandle(doc)}
        repo={{} as Repo}
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

  it("leaves Packages to the sidebar once /packages is bound", () => {
    expect(
      buttons({ moduleSettingsUrl: SETTINGS, namespace: { "/packages": [{ url: PACKAGES }] } })
    ).not.toContain("Packages");
  });
});
