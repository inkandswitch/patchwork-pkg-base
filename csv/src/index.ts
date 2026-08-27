import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  // A provenance-aware CSV table view for `file` documents: cells that other
  // documents were generated from are marked, the shared focus emphasises
  // them, and clicking a cell pushes its linked targets into the shared
  // selection. See `tool.tsx`.
  {
    type: "patchwork:tool",
    id: "csv",
    name: "CSV",
    icon: "Table",
    supportedDatatypes: ["file"],
    async load() {
      return (await import("./tool")).default;
    },
  },
];
