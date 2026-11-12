import { afterEach, describe, expect, it, vi } from "vitest";
import * as A from "@automerge/automerge";
import { EditorView } from "@codemirror/view";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { mount } from "./tool";

// Just the registry surface the editor uses. (The real package imports
// keyhive, which this package doesn't install.)
vi.mock("@inkandswitch/patchwork-plugins", () => {
  const registries = new Map<string, any>();
  const makeRegistry = () => {
    const plugins = new Map<string, any>();
    const listeners = { registered: new Set<any>(), removed: new Set<any>() };
    return {
      register(plugin: any) {
        plugins.set(plugin.id, plugin);
        listeners.registered.forEach((f) => f(plugin));
      },
      filter: (f: (p: any) => boolean) => [...plugins.values()].filter(f),
      async loadAll(list: any[]) {
        return Promise.all(
          list.map(async (p) => ({ ...p, module: await p.load() }))
        );
      },
      on(event: "registered" | "removed", f: any) {
        listeners[event].add(f);
        return () => listeners[event].delete(f);
      },
    };
  };
  return {
    getRegistry(type: string) {
      if (!registries.has(type)) registries.set(type, makeRegistry());
      return registries.get(type);
    },
  };
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the editor's datatype extensions", () => {
  it("picks up an extension that registers after it mounted", async () => {
    let doc = A.from<any>({ "@patchwork": { type: "markdown" }, content: "# hi" });
    const handle = {
      url: "automerge:2iRo1dUYYi4RGGCbJ6Hr4uD9AKbQ",
      doc: () => doc,
      heads: () => A.getHeads(doc),
      change: (fn: any) => (doc = A.change(doc, fn)),
      on() {},
      off() {},
      isReadOnly: () => false,
    };
    const element = document.createElement("div") as any;
    element.repo = { find: () => new Promise(() => {}) };
    document.body.appendChild(element);

    const dispose = mount(handle as any, element);
    await vi.waitFor(() => expect(element.querySelector(".cm-editor")).not.toBeNull());
    expect(element.querySelector(".cm-content.late-extension")).toBeNull();

    // the package with the markdown extensions arrives late, as on a refresh
    getRegistry<any>("codemirror:extension").register(
      {
        type: "codemirror:extension",
        id: "late-extension",
        supportedDatatypes: ["markdown"],
        load: async () => EditorView.contentAttributes.of({ class: "late-extension" }),
      } as any,
      "test"
    );

    const editor = element.querySelector(".cm-editor");
    await vi.waitFor(() =>
      expect(element.querySelector(".cm-content.late-extension")).not.toBeNull()
    );
    // swapped in, not remounted
    expect(element.querySelector(".cm-editor")).toBe(editor);
    (dispose as () => void)();
  });
});
