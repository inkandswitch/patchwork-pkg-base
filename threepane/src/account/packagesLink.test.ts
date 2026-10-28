import { describe, expect, it } from "vitest";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { packagesLinkUrl } from "./packagesLink";

const SETTINGS = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;
const PACKAGES = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;

describe("packagesLinkUrl", () => {
  it("links to module settings for an account without /packages", () => {
    expect(packagesLinkUrl({ moduleSettingsUrl: SETTINGS })).toBe(SETTINGS);
  });

  it("leaves packages to the sidebar once /packages is bound", () => {
    expect(
      packagesLinkUrl({
        moduleSettingsUrl: SETTINGS,
        namespace: { "/packages": [{ url: PACKAGES }] },
      })
    ).toBeUndefined();
  });

  it("links to nothing without module settings", () => {
    expect(packagesLinkUrl(undefined)).toBeUndefined();
  });
});
