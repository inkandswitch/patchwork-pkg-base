import type { Plugin, ToolElement } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:component",
    id: "patchwork-draft-state-provider",
    name: "Draft State Provider",
    async load() {
      const { DraftStateProvider } =
        await import("./providers/DraftStateProvider.js");
      return DraftStateProvider;
    },
  },
  {
    type: "patchwork:component",
    id: "patchwork-draft-overlay-provider",
    name: "Draft Overlay Provider",
    async load() {
      const { DraftOverlayProvider } =
        await import("./providers/DraftOverlayProvider.js");
      return DraftOverlayProvider;
    },
  },
  {
    type: "patchwork:component",
    id: "patchwork-workspace-provider",
    name: "Workspace Provider",
    async load() {
      const { WorkspaceProvider } =
        await import("./providers/WorkspaceProvider.js");
      return WorkspaceProvider;
    },
  },
  {
    type: "patchwork:component",
    id: "patchwork-history-provider",
    name: "History Provider",
    async load() {
      const { HistoryProvider } = await import("./history/HistoryProvider.js");
      return HistoryProvider;
    },
  },
  {
    type: "patchwork:datatype",
    id: "patchwork:draft",
    name: "Draft",
    async load() {
      const { DraftDatatype } = await import("./DraftDatatype.js");
      return DraftDatatype;
    },
    unlisted: true,
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
  // A `patchwork:component` that takes no document: the render function
  // ignores its handle (it reads everything off `element`), so we pass `null`
  // and it can be slotted in without an account doc.
  {
    type: "patchwork:component",
    id: "drafts",
    name: "Drafts",
    tags: ["context-tool"],
    async load() {
      const { renderDraftsSidebar } = await import("./main");
      return (element: ToolElement) =>
        renderDraftsSidebar(null as never, element);
    },
  },
];

export type {
  ActorAttributionDoc,
  Baseline,
  ChangeGroup,
  CheckedOutDraft,
  CloneEntry,
  DraftDoc,
  DraftList,
  DraftMemberDoc,
  DraftSummary,
  WorkspaceCheckoutsDoc,
} from "./draft-types.js";
export { isDraftDoc } from "./draft-types.js";
