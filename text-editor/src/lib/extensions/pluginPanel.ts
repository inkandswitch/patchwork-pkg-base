// The `/plugins` panel: the editable view of `doc.plugins`.
//
// Every registered `codemirror:extension` gets a checkbox bound to the array.
// The document is the truth -- ticking a box writes to it, and the editor
// reconfigures itself because the tool watches the same array.

import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { showPanel, type EditorView, type Panel } from "@codemirror/view";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import { getRegistry } from "@inkandswitch/patchwork-plugins";

export const togglePluginPanel = StateEffect.define<boolean>();

type Entry = { id: string; name?: string };

function available(): Entry[] {
  try {
    return getRegistry<any>("codemirror:extension").filter(() => true);
  } catch {
    return [];
  }
}

function enabled(handle: DocHandle<unknown>): string[] {
  const plugins = (handle.doc() as { plugins?: string[] } | undefined)?.plugins;
  return Array.isArray(plugins) ? plugins : [];
}

function toggle(handle: DocHandle<unknown>, id: string) {
  handle.change((doc: any) => {
    if (!Array.isArray(doc.plugins)) doc.plugins = [];
    const index = doc.plugins.indexOf(id);
    if (index >= 0) doc.plugins.splice(index, 1);
    else doc.plugins.push(id);
  });
}

function buildPanel(view: EditorView, handle: DocHandle<unknown>): Panel {
  const dom = document.createElement("div");
  dom.className = "text-editor-plugin-panel";

  const header = document.createElement("div");
  header.className = "header";
  const title = document.createElement("span");
  title.textContent = "Plugins";
  const close = document.createElement("button");
  close.textContent = "×";
  close.onclick = () =>
    view.dispatch({ effects: togglePluginPanel.of(false) });
  header.append(title, close);

  const list = document.createElement("div");
  list.className = "list";

  const render = () => {
    const on = enabled(handle);
    list.replaceChildren(
      ...available().map((entry) => {
        const label = document.createElement("label");
        label.className = "item";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = on.includes(entry.id);
        box.onchange = () => toggle(handle, entry.id);
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = entry.name ?? entry.id;
        const id = document.createElement("span");
        id.className = "id";
        id.textContent = entry.id;
        label.append(box, name, id);
        return label;
      })
    );
  };
  render();
  handle.on("change", render);

  dom.append(header, list);

  return {
    dom,
    top: false,
    destroy: () => handle.off("change", render),
  };
}

export function pluginPanel(handle: DocHandle<unknown>): Extension {
  return StateField.define<boolean>({
    create: () => false,
    update(open, tr) {
      for (const effect of tr.effects) {
        if (effect.is(togglePluginPanel)) return effect.value;
      }
      return open;
    },
    provide: (field) =>
      showPanel.from(field, (open) =>
        open ? (view: EditorView) => buildPanel(view, handle) : null
      ),
  });
}
