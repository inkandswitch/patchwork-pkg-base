// The why inspector: a little "?" button. Press it, point at anything in the
// frame, and it tells you what that is — which tool or component, from which
// package, showing which doc, at which heads — and what it sits inside.
//
// A patchwork:component, so the frame can mount it with
// `<patchwork-view component="why-inspector">`; if this package isn't
// installed that view simply renders nothing.

export const plugins = [
  {
    type: "patchwork:component",
    id: "why-inspector",
    name: "Why",
    icon: "Info",
    async load() {
      const { mountWhyInspector } = await import("./inspector.ts");
      return mountWhyInspector;
    },
  },
];
