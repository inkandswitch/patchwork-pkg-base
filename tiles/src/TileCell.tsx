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
  isDropTarget: boolean;
  isDragActive: boolean;
  onSetTile: (toolId: string, docUrl: string) => void;
  onClearTile: () => void;
  onBarMouseDown: (e: MouseEvent) => void;
  onDropEnter: () => void;
  onDropLeave: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onSetMain: () => void;
}

export function TileCell(props: TileCellProps) {
  return (
    <div
      class={[
        "tile-cell",
        props.isDragging ? "tile-cell--dragging" : "",
        props.isDropTarget ? "tile-cell--drop-target" : "",
        props.isMain ? "tile-cell--main" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        "grid-column": `${props.tile.col} / span ${props.tile.colSpan}`,
        "grid-row": `${props.tile.row} / span ${props.tile.rowSpan}`,
      }}
    >
      {/* ── Drag bar: click = focus, drag = move ── */}
      <div
        class="tile-bar"
        onMouseDown={props.onBarMouseDown}
        title="Drag to move · Click to focus"
      />

      {/* ── Content ── */}
      {/* Render whenever a doc is open. tool-id is passed only when explicitly
          set; otherwise patchwork-view resolves the default tool for the doc.
          The inner keyed Show remounts patchwork-view when the doc or tool
          changes — patchwork-view does not react to attribute changes in place. */}
      <Show
        when={props.tile.docUrl}
        fallback={
          <TileContentPicker
            frameDocUrl={props.frameDocUrl}
            onSet={props.onSetTile}
          />
        }
      >
        <Show when={`${props.tile.docUrl}::${props.resolvedToolId}`} keyed>
          {() => (
            <patchwork-view
              doc-url={props.tile.docUrl}
              tool-id={props.resolvedToolId || undefined}
            />
          )}
        </Show>
      </Show>

      {/* ── Hover controls ── */}
      <button
        class={`tile-ctrl tile-ctrl--set-main${props.isMain ? " tile-ctrl--set-main-active" : ""}`}
        onClick={props.onSetMain}
        title={props.isMain ? "Current document target" : "Set as document target"}
      >
        ◎
      </button>

      <Show when={props.tile.docUrl || props.tile.toolId}>
        <button
          class="tile-ctrl tile-ctrl--clear"
          onClick={props.onClearTile}
          title="Clear tile"
        >
          ×
        </button>
      </Show>

      <button
        class="tile-ctrl tile-ctrl--split-right"
        onClick={props.onSplitRight}
        title="Split right"
      >
        ⟩
      </button>

      <button
        class="tile-ctrl tile-ctrl--split-down"
        onClick={props.onSplitDown}
        title="Split down"
      >
        ⌄
      </button>

      {/* ── Drop overlay (during another tile's drag) ── */}
      <Show when={props.isDragActive && !props.isDragging}>
        <div
          class={`tile-drop-overlay${
            props.isDropTarget ? " tile-drop-overlay--active" : ""
          }`}
          onMouseEnter={props.onDropEnter}
          onMouseLeave={props.onDropLeave}
        />
      </Show>
    </div>
  );
}
