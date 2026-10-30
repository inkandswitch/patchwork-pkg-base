import { describe, expect, it } from "vitest";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { packagesLinkUrl, settingsCovered } from "./packagesLink";

const SETTINGS = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;
const PACKAGES = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;
const A = "2j9knpCseyhnK8izDmLpGP5WMdZQ";
const bound = { moduleSettingsUrl: SETTINGS, namespace: { "/packages": [{ url: PACKAGES }] } };
const covered = { modules: [`automerge:${A}`], movedToPackages: [A] };

describe("packagesLinkUrl", () => {
  it("links to module settings for an account without /packages", () => {
    expect(packagesLinkUrl({ moduleSettingsUrl: SETTINGS }, covered, true)).toBe(SETTINGS);
  });

  it("leaves packages to the sidebar once /packages covers module settings", () => {
    expect(packagesLinkUrl(bound, covered, true)).toBeUndefined();
  });

  it("keeps the button while module settings holds something /packages doesn't", () => {
    for (const modules of [
      [`automerge:${A}#abc`],
      ["https://cdn.example.test/x.js"],
      [`automerge:${A}`, "automerge:4NMNnkMhL8jXrdJ9jamS58PAVdXu"],
    ]) {
      expect(packagesLinkUrl(bound, { ...covered, modules }, true)).toBe(SETTINGS);
    }
    expect(packagesLinkUrl(bound, undefined, true)).toBe(SETTINGS);
  });

  it("keeps the button on a host that doesn't load /packages", () => {
    expect(packagesLinkUrl(bound, covered, false)).toBe(SETTINGS);
  });

  it("links to nothing without module settings", () => {
    expect(packagesLinkUrl(undefined, undefined, true)).toBeUndefined();
  });

  it("an empty module settings is covered", () => {
    expect(settingsCovered({ modules: [] })).toBe(true);
  });
});
