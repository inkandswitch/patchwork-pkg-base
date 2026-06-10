export type TileConfig = {
  id: string;
  toolId?: string;
  docUrl?: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
};

export type TilesFrameDoc = {
  tiles: TileConfig[];
  columnTracks: number[]; // fractional weights, e.g. [1, 3] → "1fr 3fr"
  rowTracks: number[];
  mainTileId?: string;    // tile that receives patchwork:open-document events
  gap: number;
};
