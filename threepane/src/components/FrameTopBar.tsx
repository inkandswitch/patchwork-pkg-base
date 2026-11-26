import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js";
import {
  getRegistry,
  type ToolDescription,
} from "@inkandswitch/patchwork-plugins";
import type { ToolSlot } from "../types";
import { dispatchLayoutEdit } from "../layoutEdits";
import { useTaggedComponents } from "../hooks";
import { DocumentTitle } from "./DocumentTitle";
import { PanelRightIcon } from "./ContextSidebar";
import { ContextMenu, copyText, type MenuAt, type MenuEntry } from "./ContextMenu";
import { slotId } from "./SlotView";
import { ToolPicker } from "./ToolPicker";

type FrameTopBarProps = {
  docUrl: Accessor<AutomergeUrl | undefined>;
  toolSlots: Accessor<ToolSlot[] | undefined>;
  /** Ids of configured doctitle tools hidden from the bar. */
  hiddenTools: Accessor<string[] | undefined>;

  isLeftCollapsed: Accessor<boolean>;

  /** Whether a context sidebar exists at all (tabs or tray) — gates the reopen
   *  toggle so we only offer it when there's something to reopen. */
  hasContext: Accessor<boolean>;
  isRightCollapsed: Accessor<boolean>;
  onToggleRight: () => void;
};

/**
 * The document column's top toolbar: the document title and tool views. Spans
 * the document column (left of the context sidebar, which carries its own tab
 * header); the left sidebar toggle is pinned separately to the frame's top-left
 * corner. When the left sidebar is collapsed the bar reserves a matching slot at
 * its start so the title slides up against (not under) that toggle. When the
 * context sidebar is collapsed a reopen toggle appears at the bar's right end.
 *
 * Right-click a doctitle tool to copy its id, hide it or remove it; right-click
 * the bar's empty space (or any tool) to add a tool or show a hidden one again. Edits are
 * sent up as `threepane:edit-layout` events for the frame to write to its
 * config doc.
 */
export function FrameTopBar(props: FrameTopBarProps) {
  let bar!: HTMLDivElement;
  const [menu, setMenu] = createSignal<{ at: MenuAt; entries: MenuEntry[] }>();
  const [picker, setPicker] = createSignal<DOMRect>();

  // Title + spacer are intrinsic to the bar and never in the config (the
  // migration drops them), so the configured doctitle tools render as-is,
  // less the hidden ones.
  const hidden = () => new Set((props.hiddenTools() ?? []).map(String));
  const docToolSlots = () =>
    (props.toolSlots() ?? []).filter((slot) => !hidden().has(slotId(slot)));

  // What "Add tool…" offers: every tool tagged `titlebar-tool` that isn't
  // showing (a hidden one is shown again by adding it).
  const titlebarTools = useTaggedComponents("titlebar-tool", "patchwork:tool");
  const addable = createMemo(() => {
    const showing = new Set(docToolSlots().map(slotId));
    return titlebarTools().filter((tool) => !showing.has(tool.id));
  });

  function onContextMenu(event: MouseEvent) {
    // The title keeps the browser's own menu (it's an input when renaming).
    const path = event.composedPath() as Element[];
    if (path.some((el) => el.classList?.contains("threepane__title"))) return;
    const id = path
      .find((el) => el instanceof HTMLElement && el.dataset.toolId)
      ?.getAttribute("data-tool-id");

    const entries: MenuEntry[] = [];
    if (id) {
      entries.push(
        { label: "Copy tool id", onSelect: () => copyText(id) },
        {
          label: "Hide",
          onSelect: () =>
            dispatchLayoutEdit(bar, { lane: "doctitle", action: "hide", id }),
        },
        {
          label: "Remove",
          onSelect: () =>
            dispatchLayoutEdit(bar, { lane: "doctitle", action: "remove", id }),
        }
      );
    }
    if (entries.length) entries.push("separator");
    const at = { x: event.clientX, y: event.clientY };
    entries.push({
      label: "Add tool…",
      onSelect: () => setPicker(new DOMRect(at.x, at.y, 0, 0)),
    });

    // Only hidden ids still configured: a stale one has nothing to show.
    const configured = new Set((props.toolSlots() ?? []).map(slotId));
    const hiddenIds = [...hidden()].filter((hid) => configured.has(hid));
    if (hiddenIds.length) {
      entries.push("separator");
      entries.push({ heading: "Hidden" });
      const tools = getRegistry<ToolDescription>("patchwork:tool");
      for (const hid of hiddenIds) {
        entries.push({
          label: `Show ${tools.get(hid)?.name || hid}`,
          onSelect: () =>
            dispatchLayoutEdit(bar, { lane: "doctitle", action: "show", id: hid }),
        });
      }
    }
    event.preventDefault();
    setMenu({ at, entries });
  }

  return (
    <div
      ref={bar}
      onContextMenu={onContextMenu}
      class="frame__topbar"
      classList={{ "frame__topbar--left-collapsed": props.isLeftCollapsed() }}
    >
      {/* document title, rendered intrinsically: shrinks to the title length,
          capped at half the bar. */}
      <Show when={props.docUrl()}>
        <div class="threepane__title">
          <DocumentTitle docUrl={props.docUrl} />
        </div>
      </Show>

      {/* built-in spacer */}
      <div class="threepane__spacer" />

      {/* configured doctitle tools, at the end on the right, scrollable.
          Unlike other lanes these always run against the currently selected
          main-view doc — they follow whatever document is open. Tuple and bare
          string are treated the same: take the slot's id as the tool, ignore
          any doc named in the tuple, and point it at the open doc. */}
      <Show when={props.docUrl() && docToolSlots().length}>
        <div class="threepane__doctitle-tools">
          <For each={docToolSlots()}>
            {(slot) => (
              <patchwork-view
                tool-id={slotId(slot)}
                doc-url={props.docUrl()}
                attr:data-tool-id={slotId(slot)}
              />
            )}
          </For>
        </div>
      </Show>

      {/* When the context sidebar is collapsed its own tab header is hidden, so
          the reopen affordance lives here at the bar's right end. When expanded
          the sidebar carries its own collapse button in its tab header. */}
      <Show when={props.hasContext() && props.isRightCollapsed()}>
        <button
          type="button"
          class="frame__sidebar-toggle"
          title="Show context sidebar"
          aria-label="Show context sidebar"
          aria-pressed={false}
          onClick={() => props.onToggleRight()}
        >
          <PanelRightIcon />
        </button>
      </Show>

      <Show when={menu()}>
        {(open) => (
          <ContextMenu
            at={open().at}
            entries={open().entries}
            label="Toolbar actions"
            onClose={() => setMenu(undefined)}
          />
        )}
      </Show>
      <Show when={picker()}>
        {(anchor) => (
          <ToolPicker
            anchor={anchor()}
            items={addable()}
            placeholder="Add or filter tools…"
            onPick={(id) =>
              dispatchLayoutEdit(bar, { lane: "doctitle", action: "add", id })
            }
            onClose={() => setPicker(undefined)}
          />
        )}
      </Show>
    </div>
  );
}
