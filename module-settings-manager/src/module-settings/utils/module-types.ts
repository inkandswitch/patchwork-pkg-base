import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import { getType } from "@inkandswitch/patchwork-filesystem";
import type { ModuleSettingsDoc } from "@inkandswitch/patchwork-filesystem";

export type BranchesDoc = {
  "@patchwork": { type: "branches" };
  branches: { [branchName: string]: AutomergeUrl };
};

// Until @inkandswitch/patchwork-filesystem ships .branches in ModuleSettingsDoc.
export type ModuleSettingsDocWithBranches = ModuleSettingsDoc & {
  branches?: Record<AutomergeUrl, string>;
};

export type ModuleEntryKind = "folder" | "directory" | "branches" | "unknown";

export const DEFAULT_BRANCH = "default";

export function getModuleEntryKind(doc: unknown): ModuleEntryKind {
  if (!doc || typeof doc !== "object") return "unknown";
  const type = getType(doc as Parameters<typeof getType>[0]);
  if (type === "directory") return "directory";
  if (type === "branches") return "branches";
  if ("docs" in doc && Array.isArray((doc as { docs?: unknown }).docs)) {
    return "folder";
  }
  return "unknown";
}

export function chosenBranchFor(
  settingsDoc: ModuleSettingsDocWithBranches | undefined,
  branchesDocUrl: AutomergeUrl
): string {
  return settingsDoc?.branches?.[branchesDocUrl] ?? DEFAULT_BRANCH;
}

export async function resolveModuleEntryToFolderUrl(
  repo: Repo,
  url: AutomergeUrl,
  settingsDoc: ModuleSettingsDocWithBranches | undefined
): Promise<AutomergeUrl | undefined> {
  const handle = await repo.find(url);
  const doc = handle.doc();
  const kind = getModuleEntryKind(doc);
  if (kind !== "branches") return url;
  const branchName = chosenBranchFor(settingsDoc, url);
  const branchUrl = (doc as BranchesDoc | undefined)?.branches?.[branchName];
  return branchUrl;
}
