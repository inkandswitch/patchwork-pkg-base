import {
  isValidAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";
import type { SideboardAccountDoc } from "../types.ts";

/**
 * The folders bound at `/packages`, in order. Package management is editing
 * them: a link in one is an installed package. Empty for an account from
 * before `/packages`, which still has the Packages tool.
 */
export function packagesFolders(
  doc: Pick<SideboardAccountDoc, "namespace"> | undefined
): AutomergeUrl[] {
  return (doc?.namespace?.["/packages"] ?? [])
    .map((binding) => binding?.url)
    .filter((url): url is AutomergeUrl => isValidAutomergeUrl(url));
}

/**
 * The folders bound at `/`, in order: the account's root, as paths see it.
 * Falls back to `rootFolderUrl` when the namespace binds nothing valid there,
 * as patchwork-filesystem's `accountBindings` does. The first is the one the
 * sidebar's root list shows, and whose rows have live paths.
 */
export function rootFolders(
  doc: Pick<SideboardAccountDoc, "rootFolderUrl" | "namespace"> | undefined
): AutomergeUrl[] {
  const bound = (doc?.namespace?.["/"] ?? [])
    .map((binding) => binding?.url)
    .filter((url): url is AutomergeUrl => isValidAutomergeUrl(url));
  if (bound.length) return bound;
  return isValidAutomergeUrl(doc?.rootFolderUrl) ? [doc!.rootFolderUrl!] : [];
}

/** What the account bar needs of the module-settings doc. */
export type ModuleSettings = { modules?: unknown[]; movedToPackages?: unknown[] };

/**
 * Whether the sidebar's packages folder stands in for the Packages tool:
 * `/packages` is bound, the host loads it (an older host reads only module
 * settings), and every module-settings entry is an unpinned automerge URL that
 * migration moved there. Pinned and http entries stay in module settings, and
 * only the Packages tool manages them.
 */
export function packagesFolderSuffices(
  doc: Pick<SideboardAccountDoc, "namespace"> | undefined,
  settings: ModuleSettings | undefined,
  hostLoadsPackages: boolean
): boolean {
  if (!hostLoadsPackages || !packagesFolders(doc).length || !settings) return false;
  const moved = new Set(Array.isArray(settings.movedToPackages) ? settings.movedToPackages : []);
  return (settings.modules ?? []).every((entry) => {
    if (typeof entry !== "string" || !entry.startsWith("automerge:")) return false;
    const id = entry.slice("automerge:".length);
    return !/[#/]/.test(id) && moved.has(id);
  });
}

/**
 * The folder the account's root list shows last, set apart: the first one
 * bound at `/packages`, when `folderUrl` is the account's root folder (the
 * first bound at `/`).
 */
export function pinnedPackagesFolder(
  account: { doc(): Pick<SideboardAccountDoc, "rootFolderUrl" | "namespace"> | undefined } | undefined,
  folderUrl: AutomergeUrl
): AutomergeUrl | undefined {
  const doc = account?.doc();
  if (!doc || rootFolders(doc)[0] !== folderUrl) return undefined;
  return packagesFolders(doc)[0];
}
