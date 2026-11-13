import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo/slim";
import { For, Show, type Accessor } from "solid-js";
import type { ThreepaneConfigDoc, ToolSlot } from "../types";
import { SlotView, slotId } from "./SlotView";
import { CALL_CONTROL_PANEL, DOCUMENT_LIST_TOOL } from "../datatypes";

/**
 * The left pane: a stack of configured widgets, each rendered via SlotView — a
 * `[toolId, docId]` tuple renders that tool against its pinned doc, a bare
 * string renders a `patchwork:component`. Normally seeded with a document list
 * on the account's root folder; the empty-state add button is a fallback for
 * when no widgets are configured (there's no add/remove UI yet).
 *
 * The call's control panel always comes last, whatever's configured (unless
 * it's configured itself). It takes no room until there's a call to show.
 *
 * A widget says how much room it wants with `data-sidebar-size` on its own
 * element: `fill` (the default: shares what's left), `fit` (as tall as it
 * is) or `none` (no room at all). styles.css reads it.
 */
export function SidebarWidgets(props: {
  widgets: Accessor<ToolSlot[]>;
  configHandle: Accessor<DocHandle<ThreepaneConfigDoc> | undefined>;
  rootFolderUrl: Accessor<AutomergeUrl | undefined>;
  // Suspend rendering until the main document has settled (mounted or failed to
  // mount), so the primary column wins the initial render race over the widgets.
  ready: Accessor<boolean>;
}) {
  const addDocumentList = () => {
    const root = props.rootFolderUrl();
    const handle = props.configHandle();
    if (!root || !handle) return;
    handle.change((doc) => {
      doc.sidebar.widgets.push([DOCUMENT_LIST_TOOL, root]);
    });
  };

  const callConfigured = () =>
    props.widgets().some((slot) => slotId(slot) === CALL_CONTROL_PANEL);

  return (
    <div class="threepane-widgets">
      <Show when={props.ready()}>
        <Show
          when={props.widgets().length}
          fallback={
            // While the config/root folder are still loading we can't add a
            // widget yet — show nothing rather than a disabled button.
            <Show when={props.rootFolderUrl() && props.configHandle()}>
              <div class="threepane-widgets__empty">
                <button
                  type="button"
                  class="threepane-widgets__add"
                  onClick={addDocumentList}
                >
                  ＋ Add document list
                </button>
              </div>
            </Show>
          }
        >
          <For each={props.widgets()}>
            {(widget) => (
              <div class="threepane-widget">
                <SlotView slot={widget} />
              </div>
            )}
          </For>
        </Show>
        <Show when={!callConfigured()}>
          <div class="threepane-widget">
            <patchwork-view component={CALL_CONTROL_PANEL} />
          </div>
        </Show>
      </Show>
    </div>
  );
}
