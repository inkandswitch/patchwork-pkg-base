import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import { hostEnv, usePackagesFolders, type FoldersEnv } from "./use-packages-folders.ts";

const SETTINGS = "automerge:3aNu5cqxaJ1vLywKRRX9kYEB8unS";
const MINE = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs";
const TEAM = "automerge:3tmVsDzywTYecevUsD21YABfXKon";
const A = "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ";
const B = "automerge:4NMNnkMhL8jXrdJ9jamS58PAVdXu";
const id = (url: string) => url.slice("automerge:".length);

const folderDoc = (title: string, docs: { name: string; url: string }[]) => ({
  title,
  docs: docs.map((d) => ({ ...d, type: "folder" })),
});

function env(docs: Record<string, object>, find?: (url: string) => Promise<unknown>): FoldersEnv {
  return {
    hostLoadsPackages: true,
    account: {
      doc: () => ({
        moduleSettingsUrl: SETTINGS,
        namespace: { "/packages": [{ url: MINE }, { url: TEAM }] },
      }),
    },
    repo: {
      find:
        find ??
        (async (url: string) => ({ url, doc: () => docs[url], change() {}, on() {}, off() {} })),
    },
  };
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  delete (globalThis as any).patchwork;
});

const mount = (e: FoldersEnv, viewing = SETTINGS, retryMs?: number) =>
  createRoot((d) => {
    dispose = d;
    return usePackagesFolders(e, viewing, retryMs);
  });

describe("usePackagesFolders", () => {
  it("links each document to the first folder that has it, saying if a shared one does too", async () => {
    const folders = mount(
      env({
        [MINE]: folderDoc("packages", [{ name: "a", url: A }]),
        [TEAM]: folderDoc("team", [{ name: "a", url: A }, { name: "b", url: B }]),
      })
    );
    await vi.waitFor(() => expect(folders.links().size).toBe(2));
    expect(folders.links().get(id(A))).toMatchObject({ mine: true, shared: true });
    expect(folders.links().get(id(B))).toMatchObject({ mine: false, title: "team" });
  });

  it("skips a second link with one name in a folder, as the host does", async () => {
    const folders = mount(
      env({ [MINE]: folderDoc("packages", [{ name: "a", url: A }, { name: "a", url: B }]), [TEAM]: folderDoc("team", []) })
    );
    await vi.waitFor(() => expect(folders.links().size).toBe(1));
    expect(folders.links().has(id(B))).toBe(false);
  });

  it("installs into nothing while viewing a settings doc that isn't the account's", () => {
    const folders = mount(env({}), "automerge:2Ldo5rBdVzfnDRCjgkRZrQ7pMUnW");
    expect(folders.hasMine()).toBe(false);
  });

  it("asks again for a folder it couldn't find", async () => {
    let fail = true;
    const docs: Record<string, object> = {
      [MINE]: folderDoc("packages", [{ name: "a", url: A }]),
      [TEAM]: folderDoc("team", []),
    };
    const folders = mount(
      env(docs, async (url) => {
        if (url === MINE && fail) throw new Error("unavailable");
        return { url, doc: () => docs[url], change() {}, on() {}, off() {} };
      }),
      SETTINGS,
      20
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(folders.links().size).toBe(0);
    fail = false;
    await vi.waitFor(() => expect(folders.links().size).toBe(1));
  });
});

describe("hostEnv", () => {
  it("uses the host's own repo, and knows the host loads /packages from its package watcher", () => {
    const repo = { find: async () => undefined };
    (globalThis as any).patchwork = { repo, account: {}, packages: { addPackagesFolder() {} } };
    const e = hostEnv({ repo: { find: async () => "draft" } });
    expect(e.repo).toBe(repo);
    expect(e.hostLoadsPackages).toBe(true);
    (globalThis as any).patchwork = { repo, packages: {} };
    expect(hostEnv(undefined).hostLoadsPackages).toBe(false);
  });
});
