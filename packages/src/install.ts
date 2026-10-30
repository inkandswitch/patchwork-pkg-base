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
export type FolderLink = { folderUrl: string; title: string; mine: boolean };

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

export function createInstaller(deps: {
  settings: ToolHandle;
  folders: Folders;
  describe: Describe;
  deactivate(importUrl: string): void;
}) {
  const intoSettings = (url: string) => {
    const key = moduleKey(url);
    if (!key) return;
    deps.settings.change((doc) => {
      if (!Array.isArray(doc.modules)) doc.modules = [];
      if (!doc.modules.some((entry) => moduleKey(entry) === key)) doc.modules.push(url);
    });
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
          linkPackage(folder, { url, name: name || documentId, type: type || "folder" });
          return;
        }
      }
      intoSettings(url);
    },

    /** Whether you can uninstall it here: it's in module settings, or your folder links it. */
    canUninstall(importUrl: string | undefined): boolean {
      const key = moduleKey(importUrl);
      if (!key) return false;
      const inSettings = (deps.settings.doc()?.modules ?? []).some(
        (entry) => moduleKey(entry) === key
      );
      return inSettings || !!deps.folders.links().get(key)?.mine;
    },

    /**
     * Take it out of module settings and your folder, and out of the live
     * registries now. A link in someone else's folder stays: removing it
     * would uninstall it for everyone who shares that folder.
     */
    async uninstall(importUrl: string | undefined): Promise<void> {
      const key = moduleKey(importUrl);
      if (!key || !importUrl) return;
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
