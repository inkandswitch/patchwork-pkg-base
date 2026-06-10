import type { Plugin, ToolImplementation } from "@inkandswitch/patchwork-plugins";
import { render } from "solid-js/web";
import type { TilesFrameDoc } from "./types";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "tiles-frame",
    name: "Tiles Frame",
    icon: "LayoutGrid",
    async load() {
      const { TilesFrameDatatype } = await import("./datatypes");
      return TilesFrameDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "tiles-frame",
    tags: ["frame-tool"],
    name: "Tiles Frame",
    icon: "LayoutGrid",
    supportedDatatypes: ["tiles-frame", "account"],
    async load(): Promise<ToolImplementation<TilesFrameDoc>> {
      const { TilesFrame } = await import("./TilesFrame");
      return (handle, element) => {
        const dispose = render(
          () => <TilesFrame handle={handle} element={element} />,
          element
        );
        return () => dispose();
      };
    },
  },
];
