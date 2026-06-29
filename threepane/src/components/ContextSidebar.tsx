import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";
import type { ToolSlot } from "../types";
import { Sidebar } from "./Sidebar";
import { Tray } from "./Tray";

type ContextSidebarProps = {
  contextToolIds: Accessor<string[] | undefined>;
  traySlots: Accessor<ToolSlot[] | undefined>;
  docUrl: AutomergeUrl;
  /**
   * Selected tab, owned by the frame *above* the branch-switch boundary so it
   * survives document and branch switches. The tab bar itself now lives in the
   * top toolbar (see `ContextTabs`); here we only render the active tool.
   */
  selectedToolId: Accessor<string | undefined>;
  isCollapsed: Accessor<boolean>;
  width: Accessor<number>;
  onMouseDown: (side: "left" | "right", e: MouseEvent) => void;
  onToggleClick: (side: "left" | "right", e: MouseEvent) => void;
};

/**
 * The document context sidebar body: renders the active context tool's content
 * plus the bottom tray. The tab bar that selects the active tool lives in the
 * top toolbar (`ContextTabs`).
 */
export function ContextSidebar(props: ContextSidebarProps) {
  const toolIds = () => props.contextToolIds() ?? [];

  // The selection may name a tool that isn't in the current list (or be unset);
  // fall back to the first tab so there's always a valid active tool.
  const activeToolId = () => {
    const ids = toolIds();
    const selected = props.selectedToolId();
    return selected && ids.includes(selected) ? selected : ids[0];
  };

  return (
    <Sidebar
      side="right"
      isCollapsed={props.isCollapsed}
      width={props.width}
      onMouseDown={props.onMouseDown}
      onToggleClick={props.onToggleClick}
      persistContent
    >
      {/* Persisted while collapsed (hidden via CSS) so the tray keeps running.
          The active context tool itself still tears down on collapse — only the
          system tray needs to stay alive secretly. */}
      <div class="context-sidebar">
        <Show when={!props.isCollapsed()}>
          <div class="context-sidebar__content">
            <Show when={activeToolId()} keyed>
              {(toolId) => (
                <patchwork-view doc-url={props.docUrl} tool-id={toolId} />
              )}
            </Show>
          </div>
        </Show>
        <Tray docUrl={props.docUrl} slots={props.traySlots} />
      </div>
    </Sidebar>
  );
}
