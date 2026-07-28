// The embed frame: chrome around a nested <patchwork-view>. Hosts (codemirror
// markers, tldraw shapes, …) mount it via <patchwork-view tool-id="embed">
// and pass the inner tool through the `embed-tool-id` attribute — the tool
// receives the <patchwork-view> element itself, so it can read attributes off
// it and dispatch events from it.
//
// Emits `patchwork:embed-tool-changed` (bubbles, composed) when the user picks
// a different tool, so the host can persist the choice wherever it lives
// (marker text, shape props, …).

import {
  getFallbackTool,
  getRegistry,
  getSupportedToolsForType,
  isLoadedPlugin,
  type DatatypeImplementation,
  type ToolDescription,
  type ToolImplementation,
} from "@inkandswitch/patchwork-plugins";
import { getType } from "@inkandswitch/patchwork-filesystem";
import { openDocument } from "@inkandswitch/patchwork-elements";
import "./embed.css";

const EMBED_TOOL_ID = "embed";

const EmbedFrame: ToolImplementation<any> = (handle, element) => {
  let currentToolId = element.getAttribute("embed-tool-id") || null;
  let datatype: DatatypeImplementation<any> | null = null;

  const root = document.createElement("div");
  root.className = "embed-frame";

  const header = document.createElement("div");
  header.className = "header";

  const titleEl = document.createElement("span");
  titleEl.className = "title";
  titleEl.textContent = "\u2026";

  const toolButton = document.createElement("button");
  toolButton.className = "tool-btn";
  toolButton.title = "Open with\u2026";

  const openButton = document.createElement("button");
  openButton.className = "open-btn";
  openButton.title = "Open document";
  openButton.innerHTML = openIcon;

  const content = document.createElement("div");
  content.className = "content";

  const view = document.createElement("patchwork-view");
  view.setAttribute("doc-url", handle.url);
  if (currentToolId) view.setAttribute("tool-id", currentToolId);

  const menu = document.createElement("div");
  menu.className = "tool-menu";
  menu.popover = "auto";
  menu.addEventListener("toggle", (e) => {
    if ((e as { newState?: string }).newState === "closed") {
      menu.replaceChildren();
    }
  });

  header.append(titleEl, toolButton, openButton);
  content.append(view);
  root.append(header, content, menu);
  element.append(root);

  titleEl.onclick = startRename;
  toolButton.onclick = () => toggleMenu();
  openButton.onclick = () =>
    openDocument(element, handle.url, currentToolId || undefined);

  function renderTitle(): void {
    titleEl.textContent = getTitle();
  }

  function getTitle(): string {
    try {
      return datatype?.getTitle(handle.doc()) || "Untitled";
    } catch {
      // getTitle may throw if the doc shape doesn't match the datatype
      return "Untitled";
    }
  }

  function renderToolButton(): void {
    toolButton.textContent = currentToolName();
  }

  function currentToolName(): string {
    if (currentToolId) {
      const tool = getRegistry<ToolDescription>("patchwork:tool").get(
        currentToolId
      );
      return tool?.name ?? currentToolId;
    }
    try {
      return getFallbackTool(handle.doc())?.name ?? "Open with\u2026";
    } catch {
      return "Open with\u2026";
    }
  }

  function setTool(toolId: string): void {
    if (!toolId || toolId === currentToolId) return;
    currentToolId = toolId;
    view.setAttribute("tool-id", toolId);
    renderToolButton();
    element.dispatchEvent(
      new CustomEvent("patchwork:embed-tool-changed", {
        detail: { url: handle.url, toolId },
        bubbles: true,
        composed: true,
      })
    );
  }

  // Rename in place: swap the title for an input; commit via the datatype's
  // setTitle so the canonical name updates for every view of the doc.
  function startRename(): void {
    if (!datatype?.setTitle) return;
    const input = document.createElement("input");
    input.className = "rename-input";
    input.value = getTitle();
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const trimmed = input.value.trim();
      if (commit && trimmed && trimmed !== getTitle()) {
        handle.change((d: any) => datatype!.setTitle!(d, trimmed));
      }
      input.replaceWith(titleEl);
      renderTitle();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    };
    input.onblur = () => finish(true);
    titleEl.replaceWith(input);
    input.focus();
    input.select();
  }

  // Replicates the sidebar's "Open with" menu: a search box filtering the
  // suggested tools, Enter on a non-match forces the typed tool id.
  function toggleMenu(): void {
    if (menu.matches(":popover-open")) {
      menu.hidePopover();
      return;
    }
    buildMenu();
    const rect = toolButton.getBoundingClientRect();
    const menuWidth = Math.max(rect.width, 180);
    menu.style.top = `${rect.bottom + 2}px`;
    menu.style.minWidth = `${menuWidth}px`;
    if (rect.left + menuWidth > window.innerWidth - 8) {
      menu.style.left = "";
      menu.style.right = `${window.innerWidth - rect.right}px`;
    } else {
      menu.style.right = "";
      menu.style.left = `${rect.left}px`;
    }
    menu.showPopover();
  }

  function buildMenu(): void {
    menu.replaceChildren();
    const tools = listTools();

    const input = document.createElement("input");
    input.className = "search";
    input.placeholder = "Search or enter tool id\u2026";
    menu.append(input);

    const list = document.createElement("div");
    list.className = "list";
    menu.append(list);

    let highlighted = 0;
    let filtered: ToolDescription[] = [];

    const pick = (toolId: string) => {
      menu.hidePopover();
      setTool(toolId);
    };

    const highlightAt = (i: number) => {
      highlighted = i;
      for (const [j, el] of [...list.children].entries()) {
        el.toggleAttribute("data-highlight", j === i);
      }
    };

    const renderList = () => {
      const q = input.value.trim().toLowerCase();
      filtered = tools.filter(
        (t) =>
          !q ||
          t.name.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q)
      );
      list.replaceChildren();
      filtered.forEach((t, i) => {
        const item = document.createElement("button");
        item.className = "item";
        if (i === highlighted) item.toggleAttribute("data-highlight", true);
        if (t.id === currentToolId) item.toggleAttribute("data-current", true);
        item.textContent = t.name || t.id;
        item.addEventListener("click", () => pick(t.id));
        item.addEventListener("pointerenter", () => highlightAt(i));
        list.append(item);
      });
    };

    input.addEventListener("input", () => {
      highlighted = 0;
      renderList();
    });

    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlightAt(Math.min(highlighted + 1, filtered.length - 1));
        list.children[highlighted]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlightAt(Math.max(highlighted - 1, 0));
        list.children[highlighted]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const q = input.value.trim();
        if (highlighted >= 0 && highlighted < filtered.length) {
          pick(filtered[highlighted].id);
        } else if (q) {
          // Force a tool id that isn't among the suggestions.
          pick(q);
        }
      } else if (e.key === "Escape") {
        menu.hidePopover();
      }
    });

    renderList();
    queueMicrotask(() => input.focus());
  }

  function listTools(): ToolDescription[] {
    const doc = handle.doc();
    const type = doc && getType(doc);
    if (!type) return [];
    const list = getSupportedToolsForType(type).filter(
      (t) => !t.unlisted && !t.forTitleBar && t.id !== EMBED_TOOL_ID
    );
    // Datatype-specific tools before the generic wildcard ones.
    list.sort((a, b) => Number(isWildcard(a)) - Number(isWildcard(b)));
    return list;
  }

  function onDocChange(): void {
    renderTitle();
    if (!currentToolId) renderToolButton();
  }

  // Load the datatype so getTitle/setTitle work and the tools it ships with
  // get registered, then re-render whatever depended on it.
  async function loadDatatype(): Promise<void> {
    const doc = handle.doc();
    const type = doc && getType(doc);
    if (!type) return;
    const registry = getRegistry("patchwork:datatype");
    try {
      await registry.load(type);
    } catch {
      // datatype unavailable; keep the fallbacks
    }
    const loaded = registry.get(type);
    if (loaded && isLoadedPlugin(loaded)) {
      datatype = loaded.module as DatatypeImplementation<any>;
    }
    titleEl.toggleAttribute("data-renamable", Boolean(datatype?.setTitle));
    if (datatype?.setTitle) titleEl.title = "Click to rename";
    renderTitle();
    renderToolButton();
  }

  renderTitle();
  renderToolButton();
  handle.on("change", onDocChange);
  void loadDatatype();

  return () => {
    handle.off("change", onDocChange);
    root.remove();
  };
};

export default EmbedFrame;

function isWildcard(tool: ToolDescription): boolean {
  return (
    tool.supportedDatatypes === "*" ||
    (Array.isArray(tool.supportedDatatypes) &&
      tool.supportedDatatypes.includes("*"))
  );
}

const openIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
	<polyline points="15 3 21 3 21 9"></polyline>
	<line x1="10" y1="14" x2="21" y2="3"></line>
</svg>`;
