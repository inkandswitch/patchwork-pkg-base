import { createSignal, onCleanup } from "solid-js";
import type { TileConfig } from "./types";

export type LayoutPreset = {
  label: string;
  columnTracks: number[];
  rowTracks: number[];
  tiles: Omit<TileConfig, "id" | "docUrl" | "toolId">[];
};

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    label: "Single",
    columnTracks: [1],
    rowTracks: [1],
    tiles: [{ col: 1, row: 1, colSpan: 1, rowSpan: 1 }],
  },
  {
    label: "Sidebar + Main",
    columnTracks: [1, 3],
    rowTracks: [1],
    tiles: [
      { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { col: 2, row: 1, colSpan: 1, rowSpan: 1 },
    ],
  },
  {
    label: "Two equal columns",
    columnTracks: [1, 1],
    rowTracks: [1],
    tiles: [
      { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { col: 2, row: 1, colSpan: 1, rowSpan: 1 },
    ],
  },
  {
    label: "Main + right split",
    columnTracks: [2, 1],
    rowTracks: [1, 1],
    tiles: [
      { col: 1, row: 1, colSpan: 1, rowSpan: 2 },
      { col: 2, row: 1, colSpan: 1, rowSpan: 1 },
      { col: 2, row: 2, colSpan: 1, rowSpan: 1 },
    ],
  },
  {
    label: "Sidebar + Main + right split",
    columnTracks: [1, 3, 2],
    rowTracks: [1, 1],
    tiles: [
      { col: 1, row: 1, colSpan: 1, rowSpan: 2 },
      { col: 2, row: 1, colSpan: 1, rowSpan: 2 },
      { col: 3, row: 1, colSpan: 1, rowSpan: 1 },
      { col: 3, row: 2, colSpan: 1, rowSpan: 1 },
    ],
  },
];

function GridIcon() {
  return (
    <div class="grid-icon" aria-hidden="true">
      {Array.from({ length: 9 }).map(() => (
        <div class="grid-icon-dot" />
      ))}
    </div>
  );
}

function PresetIcon(props: { preset: LayoutPreset }) {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": props.preset.columnTracks
          .map((t) => `${t}fr`)
          .join(" "),
        "grid-template-rows": props.preset.rowTracks
          .map((t) => `${t}fr`)
          .join(" "),
        gap: "1.5px",
        width: "32px",
        height: "22px",
        "flex-shrink": "0",
      }}
    >
      {props.preset.tiles.map((t) => (
        <div
          style={{
            "grid-column": `${t.col} / span ${t.colSpan}`,
            "grid-row": `${t.row} / span ${t.rowSpan}`,
            background: "var(--color-base-300)",
            "border-radius": "1.5px",
          }}
        />
      ))}
    </div>
  );
}

interface LayoutButtonProps {
  onApplyPreset: (preset: LayoutPreset) => void;
}

export function LayoutButton(props: LayoutButtonProps) {
  const [open, setOpen] = createSignal(false);

  const handleOpen = (e: MouseEvent) => {
    e.stopPropagation();
    setOpen((o) => !o);
  };

  const handleOutsideClick = () => setOpen(false);
  onCleanup(() => document.removeEventListener("click", handleOutsideClick));

  let wasOpen = false;
  const isOpen = () => {
    const o = open();
    if (o && !wasOpen)
      setTimeout(() => document.addEventListener("click", handleOutsideClick), 0);
    if (!o && wasOpen)
      document.removeEventListener("click", handleOutsideClick);
    wasOpen = o;
    return o;
  };

  return (
    <div class="layout-button-container">
      <button
        class={`layout-button${isOpen() ? " layout-button--active" : ""}`}
        onClick={handleOpen}
        title="Layout presets"
        aria-label="Layout presets"
      >
        <GridIcon />
      </button>

      {isOpen() && (
        <div class="layout-popup" onClick={(e) => e.stopPropagation()}>
          <span class="layout-popup-label">Layout</span>
          <div class="layout-popup-list">
            {LAYOUT_PRESETS.map((preset) => (
              <button
                class="layout-preset-button"
                onClick={() => {
                  props.onApplyPreset(preset);
                  setOpen(false);
                }}
                title={preset.label}
              >
                <PresetIcon preset={preset} />
                {preset.label}
              </button>
            ))}
          </div>
          <div class="layout-popup-hint">
            Drag tile bars to move · edges to resize · ⟩↓ to split
          </div>
        </div>
      )}
    </div>
  );
}
