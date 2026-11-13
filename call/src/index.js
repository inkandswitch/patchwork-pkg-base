// the call: one at a time, in a tab, on any doc. this module is read in a
// worker, so it's only what each plugin is, with what it does behind load()
export const plugins = [
  {
    type: "patchwork:component",
    id: "call-provider",
    name: "Call",
    async load() {
      return (await import("./provider.js")).CallProvider;
    },
  },
  {
    type: "patchwork:component",
    id: "call-face",
    name: "Call face",
    async load() {
      return (await import("./call-face.js")).CallFace;
    },
  },
  {
    type: "patchwork:component",
    id: "call-control-panel",
    name: "Call",
    async load() {
      return (await import("./control-panel.js")).CallControlPanel;
    },
  },
  {
    type: "patchwork:component",
    id: "call-video",
    tags: ["context-tool"],
    name: "Call",
    icon: "Video",
    async load() {
      return (await import("./video.js")).CallVideo;
    },
  },
  {
    type: "patchwork:tool",
    id: "call-doctitle-button",
    tags: ["titlebar-tool"],
    name: "Call button",
    icon: "Phone",
    supportedDatatypes: "*",
    unlisted: true,
    forTitleBar: true,
    load: () => import("./button.js").then((module) => module.default),
  },
];
