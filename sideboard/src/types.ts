import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo/slim";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";

export interface PatchworkToolProps<T> {
  handle: DocHandle<T>;
  repo: Repo;
  element: PatchworkViewElement;
}

/** The account-doc fields the account bar / combined sideboard read. */
export type SideboardAccountDoc = {
  rootFolderUrl?: AutomergeUrl;
  contactUrl?: AutomergeUrl;
  moduleSettingsUrl?: AutomergeUrl;
  /**
   * The account's mount table: `/packages` is package management, a union of
   * folders whose links are the installed packages.
   */
  namespace?: { [mountPoint: string]: Array<{ url: AutomergeUrl }> };
};
