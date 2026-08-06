import { type AutomergeUrl } from "@automerge/automerge-repo/slim";

export type TinyPatchworkLayoutDoc = {
  contactUrl: AutomergeUrl;
  rootFolderUrl: AutomergeUrl;
  moduleSettingsUrl: AutomergeUrl;

  frameToolId: string;
  accountSidebarToolId: string;
  contextToolIds: string[];
  documentToolbarToolIds: string[];
};

export interface AnonymousContactDoc {
  type: "anonymous";
}

export interface RegisteredContactDoc {
  type: "registered";
  name: string;
  avatarUrl?: AutomergeUrl;
}

export type ContactDoc = AnonymousContactDoc | RegisteredContactDoc;
