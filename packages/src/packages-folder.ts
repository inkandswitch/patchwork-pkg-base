// Where an install goes on a host that loads `/packages`: your packages folder,
// the first folder bound there. The host's ModuleWatcher loads whatever it
// links, so installing a package is linking it, and uninstalling is removing
// the link. Pinned and http modules still go into module settings: a folder
// link always follows the latest version, and a folder can't hold an http one.

import { documentIdOf, isAutomergeUrl } from "./origin.ts";

type Link = { name: string; type: string; url: string };

/** As much of a folder doc's handle as linking needs. */
export interface FolderHandle {
  url: string;
  doc(): { docs?: Link[] } | undefined;
  change(fn: (doc: { docs: Link[] }) => void): void;
}

export type AccountLike = {
  doc(): { namespace?: Record<string, { url?: unknown }[] | undefined> } | undefined;
};

const validUrl = (url: unknown): url is string =>
  typeof url === "string" && isAutomergeUrl(url) && !!documentIdOf(url);

/** The folders bound at `/packages`, in order: yours first. */
export function packagesFolderUrls(account: AccountLike | undefined): string[] {
  const bindings = account?.doc()?.namespace?.["/packages"];
  if (!Array.isArray(bindings)) return [];
  return bindings.map((binding) => binding?.url).filter(validUrl);
}

/** Your packages folder (the first `/packages` binding), on a host that loads `/packages`. */
export function installFolderUrl(
  account: AccountLike | undefined,
  hostLoadsPackages: boolean
): string | undefined {
  if (!hostLoadsPackages) return undefined;
  return packagesFolderUrls(account)[0];
}

/** Whether `url` goes into the packages folder: an automerge url without heads. */
export function installsIntoFolder(url: string): boolean {
  return validUrl(url) && !/[#@?/]/.test(url.slice("automerge:".length));
}

/** `name`, or `name (2)`, `name (3)`, …: the first not in `taken`. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let unique = name;
  for (let n = 2; used.has(unique); n++) unique = `${name} (${n})`;
  return unique;
}

/**
 * Link a package into the folder, under a name no other entry has (only the
 * first of a name is reachable by it). Nothing happens if the folder already
 * links that document. Checked inside the change, so two installs in a row
 * can't both add it.
 */
export function linkPackage(folder: FolderHandle, link: Link): void {
  const documentId = documentIdOf(link.url);
  if (!documentId) return;
  folder.change((doc) => {
    doc.docs ??= [];
    if (doc.docs.some((entry) => documentIdOf(String(entry?.url)) === documentId)) return;
    const name = uniqueName(
      link.name,
      doc.docs.map((entry) => String(entry?.name))
    );
    doc.docs.push({ name, type: link.type, url: link.url });
  });
}

/** Remove every link to `documentId` from the folder. True if any went. */
export function unlinkPackage(folder: FolderHandle, documentId: string): boolean {
  const linked = (entry: Link | undefined) => documentIdOf(String(entry?.url)) === documentId;
  if (!folder.doc()?.docs?.some(linked)) return false;
  folder.change((doc) => {
    for (let i = doc.docs.length - 1; i >= 0; i--) {
      if (linked(doc.docs[i])) doc.docs.splice(i, 1);
    }
  });
  return true;
}
