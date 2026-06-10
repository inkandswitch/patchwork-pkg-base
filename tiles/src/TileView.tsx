import { createSignal, onCleanup, Show } from "solid-js";
import type { TileContent } from "./types";
import { TileContentPicker } from "./TileConfigurator";
import "./patchwork-view.d.ts";

export type AddDirection = "above" | "below" | "left" | "right";

export function resolveToolId(toolId: string, d: any): string {
  if (toolId === "@sidebar") return d?.accountSidebarToolId || "";
  if (toolId === "@context") return d?.contextSidebarToolId || "";
  return toolId;
}

// Shared context handed to every panel (closes over the parent component's
// signals + callbacks, so panels stay reactive without rebuilding the grid).
export interface TileCtx {
  content: (id: string) => TileContent | undefined;
  mainTileId: () => string;
  doc: () => any;
  frameDocUrl: string;
  draggingId: () => string | null;
  // bumps on structural layout changes so patchwork-view remounts after dockview
  // reparents its element (otherwise the embedded tool goes blank on move/add).
  structGen: () => number;
  onHeaderDown: (id: string, e: MouseEvent) => void;
  addBlock: (id: string, direction: AddDirection) => void;
  removeTile: (id: string) => void;
  clearTile: (id: string) => void;
  setTile: (id: string, toolId: string, docUrl: string) => void;
}

export function TileView(props: { tileId: string; ctx: TileCtx }) {
  const c = () => props.ctx.content(props.tileId);
  const resolved = () => resolveToolId(c()?.toolId ?? "", props.ctx.doc());
  const isMain = () => props.ctx.mainTileId() === props.tileId;
  const isDragging = () => props.ctx.draggingId() === props.tileId;
  const hasContent = () => !!(c()?.docUrl || c()?.toolId);

  const [addOpen, setAddOpen] = createSignal(false);
  // Keep the menu open briefly after the pointer leaves so there's time to
  // travel from the '+' button down to the arrows.
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const openMenu = () => { clearTimeout(closeTimer); setAddOpen(true); };
  const closeMenuSoon = () => { clearTimeout(closeTimer); closeTimer = setTimeout(() => setAddOpen(false), 250); };
  onCleanup(() => clearTimeout(closeTimer));
  const add = (direction: AddDirection) => {
    clearTimeout(closeTimer);
    props.ctx.addBlock(props.tileId, direction);
    setAddOpen(false);
  };

  return (
    <div
      class={`tile-host${isDragging() ? " tile-host--dragging" : ""}`}
      data-tile-id={props.tileId}
    >
      {/* ── Header tab ── */}
      <div class={`tile-header${isMain() ? " tile-header--main" : ""}`}>
        <div
          class="tile-grab"
          onMouseDown={(e) => props.ctx.onHeaderDown(props.tileId, e)}
          title="Drag to move · Click to set as document target"
        >
          <span class="tile-grab-dots" />
        </div>

        <div class="tile-header-actions">
          <Show when={hasContent()}>
            <button
              class="tile-hbtn"
              onClick={() => props.ctx.clearTile(props.tileId)}
              title="Clear tool — choose another"
            >
              ⊘
            </button>
          </Show>

          {/* '+' : click adds to the right, hover reveals direction picker */}
          <div
            class="tile-add"
            onMouseEnter={openMenu}
            onMouseLeave={closeMenuSoon}
          >
            <button class="tile-hbtn" onClick={() => add("right")} title="Add a block">
              +
            </button>
            <Show when={addOpen()}>
              <div class="tile-add-menu">
                <button class="tile-add-dir tile-add-dir--up" onClick={() => add("above")} title="Add above">↑</button>
                <button class="tile-add-dir tile-add-dir--left" onClick={() => add("left")} title="Add left">←</button>
                <button class="tile-add-dir tile-add-dir--right" onClick={() => add("right")} title="Add right">→</button>
                <button class="tile-add-dir tile-add-dir--down" onClick={() => add("below")} title="Add below">↓</button>
              </div>
            </Show>
          </div>

          <button
            class="tile-hbtn tile-hbtn--danger"
            onClick={() => props.ctx.removeTile(props.tileId)}
            title="Remove block"
          >
            ×
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div class="tile-body">
        <Show
          when={c()?.docUrl}
          fallback={
            <TileContentPicker
              frameDocUrl={props.ctx.frameDocUrl}
              onSet={(toolId, docUrl) => props.ctx.setTile(props.tileId, toolId, docUrl)}
            />
          }
        >
          {/* Remount when doc/tool changes OR after a structural move (reparent). */}
          <Show when={`${c()!.docUrl}::${resolved()}::${props.ctx.structGen()}`} keyed>
            {(_key) => (
              <patchwork-view doc-url={c()!.docUrl} tool-id={resolved() || undefined} />
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
}
