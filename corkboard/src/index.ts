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
];
