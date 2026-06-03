import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import tldraw4Styles from "./main.css";

function addStyles(textContent: string, element: HTMLElement = document.head) {
  const id = "tldraw4-styles";
  const el = element.querySelector(`#${id}`) ?? document.createElement("style");
  Object.assign(el, { textContent, id });
  element.append(el);
}

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "tldraw4",
    name: "tldraw",
    icon: "PenLine",
    async load() {
      return (await import("./datatype.ts")).datatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "tldraw4",
    name: "tldraw",
    supportedDatatypes: ["tldraw4"],
    async load(): Promise<ToolImplementation> {
      const { render } = await import("./tool.tsx");
      return (handle, element) => {
        addStyles(tldraw4Styles);
        return render(handle, element);
      };
    },
  },
];
