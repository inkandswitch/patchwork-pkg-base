// Entry module: metadata only. Patchwork evaluates it inside a worker (no
// importmap, no DOM), so no runtime imports and no behaviour here — the
// implementation loads lazily on the main thread. Type-only imports are
// erased at compile time and are safe.
import type { Tool } from "@inkandswitch/patchwork-plugins";

export const plugins: Tool[] = [
  {
    type: "patchwork:tool",
    id: "embed",
    name: "Embed",
    icon: "PictureInPicture2",
    supportedDatatypes: "*",
    // `unlisted` is load-bearing: it keeps "Embed" out of Open With menus
    // AND out of getFallbackTool, so a tool-less nested view can never fall
    // back to the embed frame itself (which would recurse forever).
    unlisted: true,
    async load() {
      return (await import("./tool")).default;
    },
  },
];
