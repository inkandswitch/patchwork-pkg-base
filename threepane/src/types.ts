import { AutomergeUrl } from "@automerge/automerge-repo";

/**
 * The account document for a Patchwork frame.
 *
 * Scalar configuration (frame/sidebar/toolbar tool ids) is populated eagerly
 * by AccountDatatype.init. Subdocument URLs (rootFolderUrl, moduleSettingsUrl,
 * contactUrl) are optional and are lazily populated by the frame on first
 * mount via createDocOfDatatype2 of their respective datatypes.
 */
export type AccountDoc = {
  frameToolId: string;
  /** @deprecated no longer defaulted; the left pane is now sidebar.widgets */
  accountSidebarToolId?: string;
  /** @deprecated seeds migration into the threepane config doc's contextbar.tabs */
  contextToolIds?: string[];
  /** @deprecated seeds migration into the threepane config doc's doctitle.tools */
  documentToolbarToolIds?: string[];

  rootFolderUrl?: AutomergeUrl;
  moduleSettingsUrl?: AutomergeUrl;
  contactUrl?: AutomergeUrl;

  /**
   * Per-tool config doc urls, keyed by tool id. `tools["threepane"]` points at
   * a ThreepaneConfigDoc holding the sidebar/contextbar/doctitle layout.
   */
  tools?: Record<string, AutomergeUrl>;
};

/** @deprecated use AccountDoc */
export type TinyPatchworkConfigDoc = AccountDoc;

/**
 * A configured tool slot: which tool, and which document it renders against.
 * For doctitle/contextbar the docid is currently a placeholder (the frame feeds
 * the selected/account doc); for sidebar widgets it's a real pin (e.g. a folder).
 */
export type ToolRef = [toolId: string, docId: AutomergeUrl];

/**
 * One entry in a tool lane (doctitle / tray). Either a `[toolId, docId]` tuple
 * rendered as a `patchwork:tool` against the lane's fed document, or a bare
 * component id rendered as a `patchwork:component` (with no document).
 */
export type ToolSlot = ToolRef | string;

/**
 * The threepane layout config (its own document, referenced from
 * `AccountDoc.tools["threepane"]`).
 */
export type ThreepaneConfigDoc = {
  sidebar: { widgets: ToolRef[] };
  contextbar: { tabs: ToolSlot[] };
  doctitle: { tools: ToolSlot[] };
  tray: { tools: ToolSlot[] };
};
