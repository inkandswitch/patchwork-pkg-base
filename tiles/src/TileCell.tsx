import { Show } from "solid-js";
import type { TileConfig } from "./types";
import { TileContentPicker } from "./TileConfigurator";
import "./patchwork-view.d.ts";

interface TileCellProps {
  tile: TileConfig;
  frameDocUrl: string;
  resolvedToolId: string;
  isMain: boolean;
  isDragging: boolean;
  onSetTile: (toolId: string, docUrl: string) => void;
  onClearTile: () => void;
  onRemove: () => void;
  onAddBlock: () => void;
  onBarMouseDown: (e: MouseEvent) => void;
  onResizeMouseDown: (e: MouseEvent) => void;
  onSetMain: () => void;
}

export function TileCell(props: TileCellProps) {
  const hasContent = () => props.tile.docUrl || props.tile.toolId;
  return (
    <div
      class={[
        "tile-cell",
        props.isDragging ? "tile-cell--dragging" : "",
        props.isMain ? "tile-cell--main" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        "grid-column": `${props.tile.col} / span ${props.tile.colSpan}`,
        "grid-row": `${props.tile.row} / span ${props.tile.rowSpan}`,
      }}
    >
      {/* ── Header tab (consistent across every block) ── */}
      <div class="tile-header">
        <div
          class="tile-grab"
          onMouseDown={props.onBarMouseDown}
          title="Drag to move · Click to set as document target"
        >
          <span class="tile-grab-dots" />
        </div>

        <div class="tile-header-actions">
          <button
            class={`tile-hbtn${props.isMain ? " tile-hbtn--active" : ""}`}
            onClick={props.onSetMain}
            title={props.isMain ? "Document target" : "Set as document target"}
          >
            ◎
          </button>
          <button class="tile-hbtn" onClick={props.onAddBlock} title="Add a block beside this one">
            +
          </button>
          <Show when={hasContent()}>
            <button class="tile-hbtn" onClick={props.onClearTile} title="Clear contents">
              ×
            </button>
          </Show>
          <button class="tile-hbtn tile-hbtn--danger" onClick={props.onRemove} title="Remove block">
            ⌫
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div class="tile-body">
        <Show
          when={props.tile.docUrl}
          fallback={
            <TileContentPicker frameDocUrl={props.frameDocUrl} onSet={props.onSetTile} />
          }
        >
          {/* Keyed remount so patchwork-view picks up doc/tool changes. */}
          <Show when={`${props.tile.docUrl}::${props.resolvedToolId}`} keyed>
            {(_key) => (
              <patchwork-view
                doc-url={props.tile.docUrl}
                tool-id={props.resolvedToolId || undefined}
              />
            )}
          </Show>
        </Show>
      </div>

      {/* ── Resize grip (bottom-right): drag to resize this block ── */}
      <div class="tile-resize-grip" onMouseDown={props.onResizeMouseDown} title="Drag to resize" />
    </div>
  );
}
