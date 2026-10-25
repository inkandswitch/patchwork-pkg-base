import type { Plugin } from "@inkandswitch/patchwork-plugins";
import type { Repo } from "@automerge/automerge-repo/slim";

export const plugins: Plugin<any>[] = [
  // Mounted by the frame around the document area (see threepane's
  // `document-provider` tag), inside the draft overlay.
  {
    type: "patchwork:component",
    id: "patchwork-patch-layers-provider",
    name: "Patch Layers Provider",
    tags: ["document-provider"],
    async load() {
      const { PatchLayersProvider } = await import("./provider.js");
      return PatchLayersProvider;
    },
  },
  {
    type: "patchwork:component",
    id: "patches",
    name: "Patches",
    icon: "Layers",
    tags: ["context-tool"],
    async load() {
      const { renderPatchesPanel } = await import("./main");
      return (element: HTMLElement & { repo: Repo }) =>
        renderPatchesPanel(element);
    },
  },
  {
    type: "patchwork:datatype",
    id: "patch",
    name: "Patch",
    icon: "Layers",
    unlisted: true,
    async load() {
      const { PatchDatatype } = await import("./datatype.js");
      return PatchDatatype;
    },
  },
];
