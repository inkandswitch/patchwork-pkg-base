import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:component",
    id: "patchwork-workspace-provider",
    name: "Workspace Provider",
    async load() {
      const { WorkspaceProvider } = await import("./providers/WorkspaceProvider.js");
      return WorkspaceProvider;
    },
  },
  {
    type: "patchwork:component",
    id: "patchwork-draft-provider",
    name: "Draft Provider",
    async load() {
      const { DraftProvider } = await import("./providers/DraftProvider.js");
      return DraftProvider;
    },
  },
  {
    type: "patchwork:datatype",
    id: "patchwork:workspace",
    name: "Workspace",
    async load() {
      const { WorkspaceDatatype } = await import("./WorkspaceDatatype.js");
      return WorkspaceDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "drafts",
    tags: ["context-tool"],
    name: "Drafts",
    icon: "GitBranch",
    supportedDatatypes: ["account"],
    async load() {
      const { renderDraftsSidebar } = await import("./main");
      return renderDraftsSidebar;
    },
  },
];

export type { CloneEntry, WorkspaceDoc, WorkspaceState } from "./workspace-types.js";
export { isWorkspaceDoc } from "./workspace-types.js";
