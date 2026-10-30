// Installing and uninstalling. On a host that loads `/packages`, an automerge
// package is linked into your packages folder; pinned and http modules, and
// any host without `/packages`, still use the module-settings doc you're
// viewing (see packages-folder.ts).

import { bareModuleUrl, documentIdOf, moduleKey } from "./origin.ts";
import {
  installsIntoFolder,
  linkPackage,
  unlinkPackage,
  type FolderHandle,
} from "./packages-folder.ts";
import type { ToolHandle } from "./registry.ts";

/** Where a package is linked from: a `/packages` member folder. */
export type FolderLink = {
  folderUrl: string;
  title: string;
  /** The first folder that links it is yours. */
  mine: boolean;
  /** A folder that isn't yours links it too, so the host keeps loading it from there. */
  shared: boolean;
};

export interface Folders {
  /** Your packages folder, once it's loaded; undefined if there isn't one. */
  mine(): Promise<FolderHandle | undefined>;
  /** Whether there's a folder to install into, without waiting for it. */
  hasMine(): boolean;
  /** Document id → the first member folder that links it. */
  links(): Map<string, FolderLink>;
}

export type Describe = (url: string) => Promise<{ name: string; type: string }>;

/**
 * Keys of what's installed, as the host loads it: module-settings entries
 * (except bare ones migration moved to `/packages`, which load only through a
 * folder), and whatever the packages folders link.
 */
export function installedKeySet(
  modules: string[] | undefined,
  movedToPackages: string[] | undefined,
  linked: Iterable<string>
): Set<string> {
  const moved = new Set(movedToPackages ?? []);
  const keys = new Set<string>();
  for (const entry of modules ?? []) {
    const key = moduleKey(entry);
    if (!key) continue;
    const bare = bareModuleUrl(entry) === entry;
    if (bare && moved.has(key)) continue;
    keys.add(key);
  }
  for (const key of linked) keys.add(key);
  return keys;
}

type SettingsDoc = { modules?: string[]; movedToPackages?: string[] } | undefined;

// A bare entry migration moved to /packages: the host doesn't load it.
const movedEntry = (entry: string, doc: SettingsDoc) =>
  bareModuleUrl(entry) === entry && !!doc?.movedToPackages?.includes(moduleKey(entry)!);

export function createInstaller(deps: {
  settings: ToolHandle;
  /** The settings doc, read reactively where it's shown. */
  settingsDoc?: () => SettingsDoc;
  folders: Folders;
  describe: Describe;
  deactivate(importUrl: string): void;
}) {
  const settingsDoc = deps.settingsDoc ?? (() => deps.settings.doc() as SettingsDoc);
  const intoSettings = (url: string) => {
    const key = moduleKey(url);
    if (!key) return;
    deps.settings.change((doc) => {
      if (!Array.isArray(doc.modules)) doc.modules = [];
      const loaded = doc.modules.some(
        (entry) => moduleKey(entry) === key && !movedEntry(entry, doc as SettingsDoc)
      );
      if (!loaded) doc.modules.push(url);
    });
  };

  /**
   * Whether you can uninstall it here: it's in module settings or your
   * folder, and no folder you share links it, since the host would keep
   * loading it from there.
   */
  const canUninstall = (importUrl: string | undefined): boolean => {
    const key = moduleKey(importUrl);
    if (!key) return false;
    const link = deps.folders.links().get(key);
    if (link?.shared || (link && !link.mine)) return false;
    const doc = settingsDoc();
    const inSettings = (doc?.modules ?? []).some(
      (entry) => moduleKey(entry) === key && !movedEntry(entry, doc)
    );
    return inSettings || !!link?.mine;
  };

  return {
    async install(url: string): Promise<void> {
      if (installsIntoFolder(url) && deps.folders.hasMine()) {
        const folder = await deps.folders.mine();
        if (folder) {
          const documentId = documentIdOf(url)!;
          const { name, type } = await deps
            .describe(url)
            .catch(() => ({ name: documentId, type: "folder" }));
          if (linkPackage(folder, { url, name: name || documentId, type: type || "folder" })) {
            return;
          }
        }
      }
      intoSettings(url);
    },

    canUninstall,

    /**
     * Take it out of module settings and your folder, and out of the live
     * registries now. A link in someone else's folder stays: removing it
     * would uninstall it for everyone who shares that folder.
     */
    async uninstall(importUrl: string | undefined): Promise<void> {
      const key = moduleKey(importUrl);
      if (!key || !importUrl || !canUninstall(importUrl)) return;
      deps.settings.change((doc) => {
        if (!Array.isArray(doc.modules)) return;
        for (let i = doc.modules.length - 1; i >= 0; i--) {
          if (moduleKey(doc.modules[i]) === key) doc.modules.splice(i, 1);
        }
      });
      if (deps.folders.links().get(key)?.mine) {
        const folder = await deps.folders.mine();
        if (folder) unlinkPackage(folder, key);
      }
      deps.deactivate(importUrl);
    },
  };
}
