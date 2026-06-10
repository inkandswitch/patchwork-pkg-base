import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { TilesFrameDoc } from "./types";

export const TilesFrameDatatype: DatatypeImplementation<TilesFrameDoc> = {
  init(doc) {
    const sideId = crypto.randomUUID();
    const mainId = crypto.randomUUID();
    doc.columnTracks = [1, 3];
    doc.rowTracks = [1];
    doc.gap = 8;
    doc.mainTileId = mainId;
    doc.tiles = [
      { id: sideId, col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { id: mainId, col: 2, row: 1, colSpan: 1, rowSpan: 1 },
    ];
  },
  getTitle: () => "Tiles Frame",
};
