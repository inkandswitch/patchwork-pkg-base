// Embed frame: chrome (title, tool picker, open button) around a nested
// <patchwork-view>. Hosts mount it via <patchwork-view tool-id="embed">, pin
// the inner tool with the `embed-tool-id` attribute, and persist picks by
// listening for the bubbling `patchwork:embed-tool-changed` event.
//
// Two more opt-in attributes on that <patchwork-view>:
//   embed-chrome="focus"  only show the header while focus is inside the frame
//                         (for embeds that sit in running text)
//   embed-removable       show a remove button, which fires a bubbling
//                         `patchwork:embed-remove`; the host deletes the embed

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
import type { DocHandle } from "@automerge/automerge-repo";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { render } from "solid-js/web";
import "./embed.css";

const EMBED_TOOL_ID = "embed";

const EmbedFrame: ToolImplementation<any> = (handle, element) =>
  render(() => <Frame handle={handle} element={element} />, element);

export default EmbedFrame;

type FrameProps = {
  handle: DocHandle<any>;
  element: HTMLElement;
};

function Frame(props: FrameProps) {
  // Static per mount (the render contract passes them once); safe to unwrap.
  const { handle, element } = props;

  // `element` is the inner <patchwork-view-legacy>; hosts set their
  // attributes on the outer <patchwork-view>, so check there too.
  const hostAttr = (name: string) =>
    element.getAttribute(name) ??
    element.closest("patchwork-view")?.getAttribute(name) ??
    null;
  const [pinnedToolId, setPinnedToolId] = createSignal(
    hostAttr("embed-tool-id") || null
  );
  const chrome = hostAttr("embed-chrome");
  const removable = hostAttr("embed-removable") !== null;
  const [doc, setDoc] = createSignal<any>(handle.doc(), { equals: false });
  const [datatype, setDatatype] =
    createSignal<DatatypeImplementation<any> | null>(null);
  const [renaming, setRenaming] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);

  const onDocChange = () => setDoc(handle.doc());
  handle.on("change", onDocChange);
  onCleanup(() => handle.off("change", onDocChange));
  void loadDatatype();

  let menuEl!: HTMLDivElement;
  let toolButtonEl!: HTMLButtonElement;
  let listEl: HTMLDivElement | undefined;

  const title = () => {
    try {
      return datatype()?.getTitle(doc()) || "Untitled";
    } catch {
      // getTitle throws on unexpected doc shapes
      return "Untitled";
    }
  };

  const canRename = () => Boolean(datatype()?.setTitle);

  // With no pinned tool the nested view renders the doc's fallback tool, so
  // surface that as the selection rather than a special "unselected" state.
  const effectiveToolId = () => {
    datatype(); // re-check once the datatype (and the tools it ships) loaded
    if (pinnedToolId()) return pinnedToolId();
    try {
      return getFallbackTool(doc())?.id ?? null;
    } catch {
      return null;
    }
  };

  const toolName = () => {
    const toolId = effectiveToolId();
    if (!toolId) return "";
    const tool = getRegistry<ToolDescription>("patchwork:tool").get(toolId);
    return tool?.name ?? toolId;
  };

  function setTool(toolId: string): void {
    if (!toolId || toolId === pinnedToolId()) return;
    setPinnedToolId(toolId);
    element.dispatchEvent(
      new CustomEvent("patchwork:embed-tool-changed", {
        detail: { url: handle.url, toolId },
        bubbles: true,
        composed: true,
      })
    );
  }

  function remove(): void {
    element.dispatchEvent(
      new CustomEvent("patchwork:embed-remove", {
        detail: { url: handle.url },
        bubbles: true,
        composed: true,
      })
    );
  }

  function finishRename(commit: boolean, value: string): void {
    if (!renaming()) return;
    setRenaming(false);
    const trimmed = value.trim();
    if (commit && trimmed && trimmed !== title()) {
      handle.change((d: any) => datatype()!.setTitle!(d, trimmed));
    }
  }

  function toggleMenu(): void {
    if (menuEl.matches(":popover-open")) {
      menuEl.hidePopover();
      return;
    }
    setQuery("");
    setActive(0);
    setMenuOpen(true);
    const rect = toolButtonEl.getBoundingClientRect();
    const menuWidth = Math.max(rect.width, 220);
    menuEl.style.top = `${rect.bottom + 2}px`;
    menuEl.style.minWidth = `${menuWidth}px`;
    if (rect.left + menuWidth > window.innerWidth - 8) {
      menuEl.style.left = "";
      menuEl.style.right = `${window.innerWidth - rect.right}px`;
      menuEl.style.transformOrigin = "top right";
    } else {
      menuEl.style.right = "";
      menuEl.style.left = `${rect.left}px`;
      menuEl.style.transformOrigin = "top left";
    }
    menuEl.showPopover();
  }

  function listTools(): ToolDescription[] {
    const d = doc();
    const type = d && getType(d);
    if (!type) return [];
    const list = getSupportedToolsForType(type).filter(
      (t) => !t.unlisted && !t.forTitleBar && t.id !== EMBED_TOOL_ID
    );
    // Datatype-specific tools before the generic wildcard ones.
    list.sort((a, b) => Number(isWildcard(a)) - Number(isWildcard(b)));
    return list;
  }

  // What the menu offers for the current query: the matching tools, then —
  // when the query isn't exactly one of them — the query itself as a tool id,
  // so any tool (unlisted, or one meant for another datatype) can be set.
  type Option = { id: string; label: string; direct?: boolean };
  const options = createMemo<Option[]>(() => {
    if (!menuOpen()) return [];
    const q = query().trim();
    const needle = q.toLowerCase();
    const tools = listTools();
    const matches = tools
      .filter(
        (t) =>
          !needle ||
          (t.name || "").toLowerCase().includes(needle) ||
          t.id.toLowerCase().includes(needle)
      )
      .map((t): Option => ({ id: t.id, label: t.name || t.id }));
    if (q && !/[\s/\]]/.test(q) && !tools.some((t) => t.id === q)) {
      const known = getRegistry<ToolDescription>("patchwork:tool").get(q);
      matches.push({
        id: q,
        label: known?.name ? `${known.name} (${q})` : q,
        direct: true,
      });
    }
    return matches;
  });

  function pick(option: Option | undefined): void {
    if (!option) return;
    menuEl.hidePopover();
    setTool(option.id);
  }

  function moveActive(by: number): void {
    const n = options().length;
    if (!n) return;
    setActive((i) => (i + by + n) % n);
    listEl
      ?.querySelector(`[data-index="${active()}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function onSearchKey(e: KeyboardEvent): void {
    // Keep the host (editor, canvas) from acting on keys typed here.
    e.stopPropagation();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(options()[active()]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      menuEl.hidePopover();
      toolButtonEl.focus({ preventScroll: true });
    }
  }

  // Built imperatively rather than as JSX so we don't have to teach Solid's
  // JSX types about the custom element.
  const nestedView = document.createElement("patchwork-view");
  nestedView.setAttribute("doc-url", handle.url);
  createEffect(() => {
    const toolId = pinnedToolId();
    if (toolId) nestedView.setAttribute("tool-id", toolId);
    else nestedView.removeAttribute("tool-id");
  });

  // Load the datatype (for getTitle/setTitle and its tools).
  async function loadDatatype(): Promise<void> {
    const d = handle.doc();
    const type = d && getType(d);
    if (!type) return;
    const registry = getRegistry("patchwork:datatype");
    try {
      await registry.load(type);
    } catch {
      // datatype unavailable; keep the fallbacks
    }
    const loaded = registry.get(type);
    if (loaded && isLoadedPlugin(loaded)) {
      setDatatype(() => loaded.module as DatatypeImplementation<any>);
    }
  }

  return (
    <div
      class="embed-frame"
      data-chrome={chrome ?? undefined}
      // Focusable by a click anywhere in it (not by Tab), so :focus-within —
      // which shows the header in focus mode — holds wherever you click.
      tabIndex={chrome === "focus" ? -1 : undefined}
    >
      <div class="header">
        <Show
          when={!renaming()}
          fallback={
            <input
              class="rename-input"
              value={title()}
              ref={(el) =>
                queueMicrotask(() => {
                  el.focus();
                  el.select();
                })
              }
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") finishRename(true, e.currentTarget.value);
                if (e.key === "Escape")
                  finishRename(false, e.currentTarget.value);
              }}
              onBlur={(e) => finishRename(true, e.currentTarget.value)}
            />
          }
        >
          <span
            class="title"
            data-renamable={canRename() ? "" : undefined}
            title={canRename() ? "Click to rename" : undefined}
            onClick={() => canRename() && setRenaming(true)}
          >
            {title()}
          </span>
        </Show>
        <button
          class="tool-btn"
          title={"Open with\u2026"}
          ref={toolButtonEl}
          onClick={toggleMenu}
        >
          {toolName()}
        </button>
        <button
          class="icon-btn"
          title="Open"
          aria-label="Open"
          innerHTML={openIcon}
          onClick={() =>
            openDocument(element, handle.url, pinnedToolId() || undefined)
          }
        />
        <Show when={removable}>
          <button
            class="icon-btn remove-btn"
            title="Remove embed"
            aria-label="Remove embed"
            innerHTML={removeIcon}
            onClick={remove}
          />
        </Show>
      </div>
      <div class="content">{nestedView}</div>
      <div
        class="tool-menu"
        popover="auto"
        ref={(el) => {
          menuEl = el;
          // Unrender the item list while closed.
          el.addEventListener("toggle", (e) => {
            if ((e as { newState?: string }).newState === "closed") {
              setMenuOpen(false);
            }
          });
        }}
      >
        <Show when={menuOpen()}>
          <input
            class="search"
            type="text"
            placeholder="Find a tool, or type a tool id"
            spellcheck={false}
            autocomplete="off"
            value={query()}
            ref={(el) => queueMicrotask(() => el.focus({ preventScroll: true }))}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={onSearchKey}
          />
          <div class="list" ref={listEl}>
            <For
              each={options()}
              fallback={<div class="empty">No matching tools</div>}
            >
              {(option, i) => (
                <button
                  class="item"
                  data-index={i()}
                  data-active={i() === active() ? "" : undefined}
                  data-current={
                    option.id === effectiveToolId() ? "" : undefined
                  }
                  data-direct={option.direct ? "" : undefined}
                  onPointerMove={() => setActive(i())}
                  onClick={() => pick(option)}
                >
                  <Show when={option.direct}>
                    <span class="hint">Use tool id</span>
                  </Show>
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

function isWildcard(tool: ToolDescription): boolean {
  return (
    tool.supportedDatatypes === "*" ||
    (Array.isArray(tool.supportedDatatypes) &&
      tool.supportedDatatypes.includes("*"))
  );
}

// Expand arrows (lucide "maximize-2"): the button opens the doc here, in the
// main view, not in a new tab — which the external-link glyph promised.
const openIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<polyline points="15 3 21 3 21 9"></polyline>
	<polyline points="9 21 3 21 3 15"></polyline>
	<line x1="21" y1="3" x2="14" y2="10"></line>
	<line x1="3" y1="21" x2="10" y2="14"></line>
</svg>`;

const removeIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<line x1="18" y1="6" x2="6" y2="18"></line>
	<line x1="6" y1="6" x2="18" y2="18"></line>
</svg>`;
