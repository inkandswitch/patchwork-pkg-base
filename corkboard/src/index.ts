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
  // Renders provenance in text editors: a codemirror-base extension FACTORY
  // (it receives the editor's {handle, element, repo} context) that
  // underlines provenance source ranges and pushes their linked targets into
  // the shared focus selection. Inert outside a provenance provider.
  {
    type: "codemirror:extension",
    id: "codemirror-provenance",
    name: "Provenance highlights",
    supportedDatatypes: "*",
    async load() {
      const { provenanceExtension } = await import(
        "./codemirror-provenance.js"
      );
      return provenanceExtension;
    },
  },
  // Tells the chat computer which document datatypes this Patchwork actually
  // has installed, by reading the `patchwork:datatype` registry. Nothing
  // canvas-specific, and deliberately bound to no datatype, so it never
  // auto-activates: it sits in the computer's skills index until something
  // needs it (load_skill, or the tldraw skill below pointing at it).
  {
    type: "llm:skill",
    id: "patchwork-datatypes",
    name: "Patchwork Datatypes",
    description:
      "Lists the document datatypes installed in this Patchwork (ids and names) via the plugin registry. Applies whenever you need a datatype id — before creating a document, or before naming a type you haven't read.",
    async load() {
      const { skill } = await import("./llm-skill-datatypes.js");
      return skill;
    },
  },
  // Instruction pack for Patchwork's chat computer (the `llm:skill` type the
  // chat tool consumes): how to create and edit tldraw canvases with the
  // generic document tools, plus a create_doc_on_canvas tool that makes a new
  // document of a datatype and embeds it. Auto-activates on a focused tldraw5.
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
