import * as filesystem from "@inkandswitch/patchwork-filesystem";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import type { AccountDoc } from "../types";

/** What the account bar needs of the module-settings doc. */
export type ModuleSettings = { modules?: unknown[]; movedToPackages?: unknown[] };

/** Whether the host loads packages from `/packages` (an older host reads only module settings). */
const hostHasPackages = () =>
  typeof (filesystem as Record<string, unknown>).watchPackagesFolder === "function";

/**
 * Whether `/packages` stands in for every module-settings entry: each is an
 * unpinned automerge URL that migration moved there. Pinned and http entries
 * stay in module settings, and only the Packages tool manages them.
 */
export function settingsCovered(settings: ModuleSettings | undefined): boolean {
  if (!settings) return false;
  const moved = new Set(Array.isArray(settings.movedToPackages) ? settings.movedToPackages : []);
  return (settings.modules ?? []).every((entry) => {
    if (typeof entry !== "string" || !entry.startsWith("automerge:")) return false;
    const id = entry.slice("automerge:".length);
    return !/[#/]/.test(id) && moved.has(id);
  });
}

/**
 * Where the account bar's Packages button goes: the module-settings doc. It
 * goes away only once the sidebar's packages folder covers everything there:
 * `/packages` is bound, the host loads it, and module settings holds nothing
 * else.
 */
export function packagesLinkUrl(
  doc: Pick<AccountDoc, "moduleSettingsUrl" | "namespace"> | undefined,
  settings: ModuleSettings | undefined,
  hostLoadsPackages: boolean = hostHasPackages()
): AutomergeUrl | undefined {
  if (hostLoadsPackages && doc?.namespace?.["/packages"]?.length && settingsCovered(settings)) {
    return undefined;
  }
  return doc?.moduleSettingsUrl;
}
