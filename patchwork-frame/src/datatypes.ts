import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import type { AccountDoc } from "./types";

/**
 * Default scalar configuration for a fresh account. Subdoc URLs are intentionally
 * absent and are populated lazily by the frame on first mount.
 */
export const AccountDatatype: DatatypeImplementation<AccountDoc> = {
  init(doc) {
    doc.frameToolId = "patchwork-frame";
    doc.accountSidebarToolId = "chee/sideboard";
    doc.contextSidebarToolId = "context-sidebar";
    doc.contextToolIds = ["comments-view", "history-view", "context-view"];
    doc.documentToolbarToolIds = [
      "document-title",
      "back-link-button",
      "spacer",
      "highlight-changes-checkbox",
      "add-doc-to-sidebar-button",
    ];
  },
  getTitle: () => "Patchwork Account",
};

export const FolderDatatype: DatatypeImplementation<FolderDoc> = {
  init(doc) {
    doc.title = "";
    doc.docs = [];
  },
  getTitle: (doc) => doc.title || "Untitled Folder",
  setTitle: (doc, title) => {
    doc.title = title;
  },
};
