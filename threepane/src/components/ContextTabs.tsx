import { createSignal, For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { dispatchLayoutEdit, type LaneItem } from "../layoutEdits";
import { ContextMenu, copyText, type MenuAt, type MenuEntry } from "./ContextMenu";
import { ToolPicker } from "./ToolPicker";

type ContextTabsProps = {
  /** The tabs in the bar, and the ones hidden from it. */
  items: Accessor<LaneItem[]>;
  hidden: Accessor<LaneItem[]>;
  /** What the "+" offers. */
  addable: Accessor<LaneItem[]>;
  selectedToolId: Accessor<string | undefined>;
  setSelectedToolId: (id: string) => void;
};

/**
 * The context sidebar's tab bar. Horizontally scrollable when the tabs
 * overflow, with a "+" at the very end to add a tab. Selection is owned by the
 * frame so it survives branch switches.
 *
 * Right-click a tab to copy its id, hide it or remove it; right-click anywhere
 * on the bar to show a hidden one again. Edits are sent up as
 * `threepane:edit-layout` events for the frame to write to its config doc.
 */
export function ContextTabs(props: ContextTabsProps) {
  let tablist!: HTMLDivElement;
  const [menu, setMenu] = createSignal<{ at: MenuAt; entries: MenuEntry[] }>();
  const [picker, setPicker] = createSignal<DOMRect>();

  const activeToolId = () => {
    const ids = props.items().map((item) => item.id);
    const selected = props.selectedToolId();
    return selected && ids.includes(selected) ? selected : ids[0];
  };

  function onContextMenu(event: MouseEvent) {
    const tab = (event.target as Element).closest<HTMLElement>("[data-tool-id]");
    const id = tab?.dataset.toolId;
    const entries: MenuEntry[] = [];
    if (id) {
      entries.push(
        { label: "Copy tool id", onSelect: () => copyText(id) },
        {
          label: "Hide",
          onSelect: () =>
            dispatchLayoutEdit(tablist, { lane: "context", action: "hide", id }),
        },
        {
          label: "Remove",
          onSelect: () =>
            dispatchLayoutEdit(tablist, { lane: "context", action: "remove", id }),
        }
      );
    }
    const hidden = props.hidden();
    if (hidden.length) {
      if (entries.length) entries.push("separator");
      entries.push({ heading: "Hidden" });
      for (const item of hidden) {
        entries.push({
          label: `Show ${item.name}`,
          onSelect: () => {
            dispatchLayoutEdit(tablist, {
              lane: "context",
              action: "show",
              id: item.id,
            });
            props.setSelectedToolId(item.id);
          },
        });
      }
    }
    if (!entries.length) return;
    event.preventDefault();
    setMenu({ at: { x: event.clientX, y: event.clientY }, entries });
  }

  function add(id: string) {
    dispatchLayoutEdit(tablist, { lane: "context", action: "add", id });
    props.setSelectedToolId(id);
  }

  return (
    <div
      ref={tablist}
      role="tablist"
      class="context-sidebar__tablist"
      onContextMenu={onContextMenu}
    >
      <For each={props.items()}>
        {(item) => (
          <button
            type="button"
            role="tab"
            class="context-sidebar__tab"
            data-tool-id={item.id}
            data-active={activeToolId() === item.id ? "" : undefined}
            aria-selected={activeToolId() === item.id}
            onClick={() => props.setSelectedToolId(item.id)}
          >
            {item.name}
          </button>
        )}
      </For>
      {/* last in the scrolling list, so it's there once you reach the end */}
      <button
        type="button"
        class="context-sidebar__add"
        title="Add a tab"
        aria-label="Add a tab"
        aria-haspopup="listbox"
        aria-expanded={!!picker()}
        onClick={(event) =>
          setPicker(
            picker() ? undefined : event.currentTarget.getBoundingClientRect()
          )
        }
      >
        <PlusIcon />
      </button>

      <Show when={menu()}>
        {(open) => (
          <ContextMenu
            at={open().at}
            entries={open().entries}
            label="Tab actions"
            onClose={() => setMenu(undefined)}
          />
        )}
      </Show>
      <Show when={picker()}>
        {(anchor) => (
          <ToolPicker
            anchor={anchor()}
            items={props.addable()}
            placeholder="Search or enter a component id…"
            onPick={add}
            onClose={() => setPicker(undefined)}
          />
        )}
      </Show>
    </div>
  );
}

// lucide `plus`
function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}
