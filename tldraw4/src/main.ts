import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";

import "./main.css";

function addStyles(textContent: string, element: HTMLElement = document.head) {
  const id = "tldraw4-styles";
  const el = element.querySelector(`#${id}`) ?? document.createElement("style");
  Object.assign(el, { textContent, id });
  element.append(el);
}

async function loadStyles() {
  const url = new URL("./main.css", import.meta.url);
  return (await fetch(url)).text();
}

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "tldraw4",
    name: "tldraw4",
    icon: "PenLine",
    // New canvases are tldraw5 now; this datatype stays registered so existing
    // documents still open, but is no longer offered for new ones.
    unlisted: true,
    async load() {
      return (await import("./datatype.ts")).datatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "tldraw4",
    name: "tldraw4",
    supportedDatatypes: ["tldraw4"],
    async load(): Promise<ToolImplementation> {
      const { render } = await import("./tool.tsx");
      const styles = await loadStyles();
      return (handle, element) => {
        addStyles(styles);
        return render(handle, element);
      };
    },
  },
];
