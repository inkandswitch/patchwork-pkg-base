import { describe, expect, it, vi } from "vitest";
import { createInstaller, installedKeySet, type FolderLink, type Folders } from "./install.ts";
import type { FolderHandle } from "./packages-folder.ts";

const MINE = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs";
const TEAM = "automerge:3tmVsDzywTYecevUsD21YABfXKon";
const PKG = "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ";
const TEAM_PKG = "automerge:3aNu5cqxaJ1vLywKRRX9kYEB8unS";
const id = (url: string) => url.slice("automerge:".length);

function folder(url: string, docs: { name: string; type: string; url: string }[] = []): FolderHandle {
  const doc = { title: "packages", docs };
  return { url, doc: () => doc, change: (fn) => fn(doc) };
}

function setup(
  options: {
    mine?: Promise<FolderHandle | undefined>;
    describe?: () => Promise<{ name: string; type: string }>;
    alsoShared?: string[];
    movedToPackages?: string[];
  } = {}
) {
  const settingsDoc = { modules: [] as string[], movedToPackages: options.movedToPackages };
  const settings = {
    url: "automerge:settingssettingsset",
    doc: () => settingsDoc,
    change: (fn: (d: { modules?: string[] }) => void) => fn(settingsDoc),
    on() {},
    off() {},
  };
  const mine = folder(MINE);
  const team = folder(TEAM, [{ name: "teamy", type: "folder", url: TEAM_PKG }]);
  const folders: Folders = {
    mine: () => (options.mine ? options.mine : Promise.resolve(mine)),
    hasMine: () => true,
    links: () =>
      new Map<string, FolderLink>([
        [id(TEAM_PKG), { folderUrl: TEAM, title: "team", mine: false, shared: true }],
        ...(mine.doc()!.docs ?? []).map(
          (d) =>
            [
              id(d.url),
              { folderUrl: MINE, title: "packages", mine: true, shared: !!options.alsoShared?.includes(d.url) },
            ] as const
        ),
      ]),
  };
  const deactivate = vi.fn();
  const installer = createInstaller({
    settings,
    settingsDoc: () => settingsDoc,
    folders,
    describe: options.describe ?? (async () => ({ name: "alpha", type: "directory" })),
    deactivate,
  });
  return { settingsDoc, mine, team, installer, deactivate };
}

describe("install", () => {
  it("links an automerge package into your folder, named from its package, and leaves module settings alone", async () => {
    const { settingsDoc, mine, installer } = await setup();
    await installer.install(PKG);
    expect(mine.doc()!.docs).toEqual([{ name: "alpha", type: "directory", url: PKG }]);
    expect(settingsDoc.modules).toEqual([]);
  });

  it("writes pinned and http modules to module settings", async () => {
    const { settingsDoc, mine, installer } = await setup();
    await installer.install(`${PKG}#abc`);
    await installer.install("https://cdn.example.test/x.js");
    expect(settingsDoc.modules).toEqual([`${PKG}#abc`, "https://cdn.example.test/x.js"]);
    expect(mine.doc()!.docs).toEqual([]);
  });

  it("writes module settings when there's no packages folder to write to", async () => {
    const { settingsDoc, installer } = setup({ mine: Promise.resolve(undefined) });
    await installer.install(PKG);
    expect(settingsDoc.modules).toEqual([PKG]);
  });

  it("names a package it can't read by its document id", async () => {
    const { mine, installer } = setup({ describe: () => Promise.reject(new Error("unavailable")) });
    await installer.install(PKG);
    expect(mine.doc()!.docs).toEqual([{ name: id(PKG), type: "folder", url: PKG }]);
  });

  it("waits for your folder rather than writing module settings", async () => {
    let release!: (folder: FolderHandle) => void;
    const slow = new Promise<FolderHandle | undefined>((resolve) => (release = resolve));
    const { settingsDoc, installer } = setup({ mine: slow });
    const later = folder(MINE);
    const installing = installer.install(PKG);
    release(later);
    await installing;
    expect(later.doc()!.docs).toHaveLength(1);
    expect(settingsDoc.modules).toEqual([]);
  });

  it("doesn't link a package twice", async () => {
    const { mine, installer } = await setup();
    await installer.install(PKG);
    await installer.install(PKG);
    expect(mine.doc()!.docs).toHaveLength(1);
  });
});

describe("uninstall", () => {
  it("unlinks a package from your folder and from module settings, and deactivates it", async () => {
    const { settingsDoc, mine, installer, deactivate } = await setup();
    await installer.install(PKG);
    settingsDoc.modules.push(`${PKG}#abc`);
    expect(installer.canUninstall(PKG)).toBe(true);
    await installer.uninstall(PKG);
    expect(mine.doc()!.docs).toEqual([]);
    expect(settingsDoc.modules).toEqual([]);
    expect(deactivate).toHaveBeenCalledWith(PKG);
  });

  it("can't uninstall a package another folder links", async () => {
    const { team, installer } = await setup();
    expect(installer.canUninstall(TEAM_PKG)).toBe(false);
    await installer.uninstall(TEAM_PKG);
    expect(team.doc()!.docs).toHaveLength(1);
  });
});

describe("installedKeySet", () => {
  it("is what module settings and the packages folders load", () => {
    const keys = installedKeySet(
      [PKG, `${TEAM_PKG}`, "https://x.test/a.js", "automerge:4NMNnkMhL8jXrdJ9jamS58PAVdXu"],
      [id("automerge:4NMNnkMhL8jXrdJ9jamS58PAVdXu")],
      new Set([id(MINE)])
    );
    // A moved entry no folder links any more isn't loaded, so it isn't installed.
    expect([...keys].sort()).toEqual([id(PKG), id(TEAM_PKG), "https://x.test/a.js", id(MINE)].sort());
  });
});

describe("review fixes", () => {
  it("can't uninstall a package a shared folder links too, even if yours does", async () => {
    const { installer } = setup({ alsoShared: [PKG] });
    await installer.install(PKG);
    expect(installer.canUninstall(PKG)).toBe(false);
  });

  it("installs a pinned module even where a moved bare entry for it is left over", async () => {
    const { settingsDoc, installer } = setup({ movedToPackages: [id(PKG)] });
    settingsDoc.modules.push(PKG);
    await installer.install(`${PKG}#abc`);
    expect(settingsDoc.modules).toEqual([PKG, `${PKG}#abc`]);
  });

  it("writes module settings when your /packages binding isn't a folder", async () => {
    const notAFolder: FolderHandle = { url: MINE, doc: () => ({}) as any, change: () => {} };
    const { settingsDoc, installer } = setup({ mine: Promise.resolve(notAFolder) });
    await installer.install(PKG);
    expect(settingsDoc.modules).toEqual([PKG]);
  });
});
