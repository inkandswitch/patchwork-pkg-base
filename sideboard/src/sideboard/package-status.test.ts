import { afterEach, describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { packageTooltip, usePackageStatus } from "./package-status.ts";

const PKG = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;
const OTHER = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;

/** A stand-in for patchwork's ModuleWatcher: statuses, and a "status" event. */
class FakePackages extends EventTarget {
  statuses = new Map<string, unknown>();
  packageStatus(url: string) {
    return this.statuses.get(url);
  }
  set(url: string, status: unknown) {
    this.statuses.set(url, status);
    this.dispatchEvent(new Event("status"));
  }
}

afterEach(() => {
  delete (globalThis as { patchwork?: unknown }).patchwork;
});

describe("usePackageStatus", () => {
  it("follows a package's status as it changes", () => {
    const packages = new FakePackages();
    (globalThis as { patchwork?: unknown }).patchwork = { packages };
    createRoot((dispose) => {
      const status = usePackageStatus(() => PKG);
      expect(status()).toBeUndefined();
      packages.set(PKG, { state: "loading" });
      expect(status()).toEqual({ state: "loading" });
      packages.set(PKG, { state: "loaded", plugins: ["editor"] });
      expect(status()?.state).toBe("loaded");
      dispose();
    });
  });

  it("is undefined for a document that isn't a package", () => {
    const packages = new FakePackages();
    (globalThis as { patchwork?: unknown }).patchwork = { packages };
    packages.set(PKG, { state: "loaded", plugins: [] });
    createRoot((dispose) => {
      expect(usePackageStatus(() => OTHER)()).toBeUndefined();
      dispose();
    });
  });

  it("is undefined on a patchwork without package status", () => {
    (globalThis as { patchwork?: unknown }).patchwork = { packages: {} };
    createRoot((dispose) => {
      expect(usePackageStatus(() => PKG)()).toBeUndefined();
      dispose();
    });
  });
});

describe("packageTooltip", () => {
  it("says what loaded, or why not", () => {
    expect(packageTooltip({ state: "loaded", plugins: ["a", "b"] })).toBe("Loaded: a, b");
    expect(packageTooltip({ state: "failed", error: "boom" })).toBe("Failed to load: boom");
    expect(packageTooltip({ state: "loading" })).toBe("Loading…");
  });
});
