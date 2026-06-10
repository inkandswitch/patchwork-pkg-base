import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { TilesFrameDoc } from "./types";

export const TilesFrameDatatype: DatatypeImplementation<TilesFrameDoc> = {
  init(doc) {
    // The dockview layout + content are built lazily on first mount, once we
    // have panel ids to key everything by.
    doc.content = {};
  },
  getTitle: () => "Tiles Frame",
};
