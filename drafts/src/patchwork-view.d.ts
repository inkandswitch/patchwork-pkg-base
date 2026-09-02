// The <patchwork-view> custom element in Solid JSX (the runtime registers it
// globally; this only teaches the type checker the attributes we use).
declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "patchwork-view": {
        class?: string;
        "doc-url"?: string;
        "tool-id"?: string;
      };
    }
  }
}

export {};
