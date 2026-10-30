// The live path of a row in the account's root folder (`<acctHash>/Projects/foo`)
// so opening it sets `&path=` and hands the tool `<patchwork-view path>`. The path
// grammar is patchwork-filesystem's, from the host at runtime (it's an importmap
// external), so it can't drift from the router's. A host from before paths has
// none, and rows open without a path.
import * as filesystem from "@inkandswitch/patchwork-filesystem";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { createResource, type Resource } from "solid-js";
import type { OpenDocumentEventDetail } from "@inkandswitch/patchwork-elements";
import type { SideboardAccountDoc } from "../types.ts";
import { rootFolders } from "./packages.ts";

/**
 * An open-document request that may say where it was opened from. `path` is on
 * `OpenDocumentEventDetail` in patchwork-elements releases with paths; spelled
 * out here so this builds against older ones too.
 */
export type OpenDetail = OpenDocumentEventDetail & { path?: string };

export type LivePathOf = (names: string[]) => string;

/** What this needs of patchwork-filesystem; optional, since older hosts lack it. */
type PathGrammar = {
  idhash(documentId: string): Promise<string>;
  livePath(acctHash: string, names: string[]): string;
};

/**
 * Live paths for rows under `folderUrl`, if it's `account`'s root folder, the
 * first bound at `/` (paths start at the account, so only its tree has them;
 * a name in a later `/` member may be shadowed by the first), and the host has
 * paths. Undefined otherwise.
 */
export async function livePathsFor(
  account:
    | {
        documentId: string;
        doc(): Pick<SideboardAccountDoc, "rootFolderUrl" | "namespace"> | undefined;
      }
    | undefined,
  folderUrl: AutomergeUrl,
  grammar: Partial<PathGrammar> = filesystem as Partial<PathGrammar>
): Promise<LivePathOf | undefined> {
  const { idhash, livePath } = grammar;
  if (typeof idhash !== "function" || typeof livePath !== "function") return undefined;
  if (!account || rootFolders(account.doc())[0] !== folderUrl) return undefined;
  const acctHash = await idhash(account.documentId);
  return (names) => livePath(acctHash, names);
}

type LivePathAccount = Parameters<typeof livePathsFor>[0];

/**
 * {@link livePathsFor} for the list showing `folderUrl`, kept current: asked
 * again when the folder changes, or when `accountChanged` says the account did
 * and that moved whether the folder is first at `/`. A list stays mounted when
 * `/` is rebound around it, so it can't count on being made again.
 */
export function createLivePaths(
  folderUrl: () => AutomergeUrl,
  account: () => LivePathAccount,
  accountChanged: () => unknown,
  grammar?: Partial<PathGrammar>
): Resource<LivePathOf | undefined> {
  const [livePathOf] = createResource(
    () => {
      accountChanged();
      const url = folderUrl();
      return `${rootFolders(account()?.doc())[0] === url}:${url}`;
    },
    () => livePathsFor(account(), folderUrl(), grammar)
  );
  return livePathOf;
}
