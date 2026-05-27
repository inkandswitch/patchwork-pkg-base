import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

import type { WorkspaceDoc } from "./workspace-types.js";

export const WorkspaceDatatype: DatatypeImplementation<WorkspaceDoc> = {
  init(doc: WorkspaceDoc) {
    doc["@patchwork"] = { type: "workspace" };
    doc.parent = null;
    doc.drafts = [];
    doc.clones = {};
  },
  getTitle() {
    return "Workspace";
  },
};
