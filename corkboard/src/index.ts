import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  // A tldraw canvas wrapped in the provenance provider: docs pinned to the
  // canvas mount inside the provider, so cross-document provenance links
  // resolve for all of them (a text doc learns which of its ranges another
  // doc was generated from).
  {
    type: "patchwork:tool",
    id: "corkboard",
    name: "Corkboard",
    icon: "Pin",
    supportedDatatypes: ["tldraw5"],
    async load() {
      return (await import("./tool")).default;
    },
  },
  // Answers `patchwork:provenance` subscriptions for every doc mounted
  // inside it. Registered separately so other hosts (e.g. a frame) can mount
  // it without the corkboard tool.
  {
    type: "patchwork:component",
    id: "patchwork-provenance-provider",
    name: "Provenance Provider",
    async load() {
      const { ProvenanceProvider } = await import("./ProvenanceProvider.js");
      return ProvenanceProvider;
    },
  },
  // Instruction pack for Patchwork's chat computer (the `llm:skill` type the
  // chat tool consumes): how to create and edit tldraw canvases with the
  // generic document tools. Auto-activates when a tldraw5 doc is focused.
  {
    type: "llm:skill",
    id: "tldraw5",
    name: "tldraw Canvas",
    description:
      "Create and edit tldraw canvases — shapes, sticky notes, frames, arrows with bindings, and embedded Patchwork documents. Applies when the focused document is a tldraw5 canvas, or when the user asks to draw, diagram, or lay something out on a canvas.",
    datatypes: ["tldraw5"],
    async load() {
      const { skill } = await import("./llm-skill.js");
      return skill;
    },
  },
];
