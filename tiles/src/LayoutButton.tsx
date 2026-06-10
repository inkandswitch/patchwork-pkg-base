import { createSignal, onCleanup } from "solid-js";

export type PresetKey = "single" | "sidebar-main" | "two-col" | "main-split";

const PRESETS: { key: PresetKey; label: string; cells: { flexRow?: number[]; rows?: number }[] }[] = [
  { key: "single", label: "Single", cells: [{ flexRow: [1] }] },
  { key: "sidebar-main", label: "Sidebar + Main", cells: [{ flexRow: [1, 3] }] },
  { key: "two-col", label: "Two columns", cells: [{ flexRow: [1, 1] }] },
  { key: "main-split", label: "Main + split", cells: [{ flexRow: [2, 1] }] },
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

function PresetIcon(props: { preset: { key: PresetKey } }) {
  // Simple flex mock of each layout
  const k = props.preset.key;
  return (
    <div class="preset-icon">
      {k === "single" && <div class="preset-cell" style={{ flex: 1 }} />}
      {k === "sidebar-main" && (
        <>
          <div class="preset-cell" style={{ flex: 1 }} />
          <div class="preset-cell" style={{ flex: 3 }} />
        </>
      )}
      {k === "two-col" && (
        <>
          <div class="preset-cell" style={{ flex: 1 }} />
          <div class="preset-cell" style={{ flex: 1 }} />
        </>
      )}
      {k === "main-split" && (
        <>
          <div class="preset-cell" style={{ flex: 2 }} />
          <div class="preset-icon-col">
            <div class="preset-cell" style={{ flex: 1 }} />
            <div class="preset-cell" style={{ flex: 1 }} />
          </div>
        </>
      )}
    </div>
  );
}

interface LayoutButtonProps {
  onApplyPreset: (key: PresetKey) => void;
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
    if (o && !wasOpen) setTimeout(() => document.addEventListener("click", handleOutsideClick), 0);
    if (!o && wasOpen) document.removeEventListener("click", handleOutsideClick);
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
            {PRESETS.map((preset) => (
              <button
                class="layout-preset-button"
                onClick={() => {
                  props.onApplyPreset(preset.key);
                  setOpen(false);
                }}
                title={preset.label}
              >
                <PresetIcon preset={preset} />
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
