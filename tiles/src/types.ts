export type TileContent = {
  toolId: string;
  docUrl: string;
};

export type TilesFrameDoc = {
  // Serialized dockview Gridview layout (panel ids + sizes). dockview owns this.
  layout?: any;
  // Per-panel content, keyed by the gridview panel id.
  content?: Record<string, TileContent>;
  // Panel that receives patchwork:open-document events.
  mainTileId?: string;
  // Account slot settings (present when this is the account frame).
  accountSidebarToolId?: string;
  contextSidebarToolId?: string;
};
