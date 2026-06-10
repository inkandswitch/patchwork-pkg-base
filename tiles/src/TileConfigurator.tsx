import { createSignal } from "solid-js";

// "@sidebar" / "@context" are reference markers, not literal tool IDs. They
// resolve at render time to the account doc's accountSidebarToolId /
// contextSidebarToolId, so changing those in settings updates the tile live.
const QUICK_TOOLS = [
  { label: "Sideboard", toolId: "@sidebar" },
  { label: "Context Sidebar", toolId: "@context" },
];

interface TileContentPickerProps {
  frameDocUrl: string;
  onSet: (toolId: string, docUrl: string) => void;
}

export function TileContentPicker(props: TileContentPickerProps) {
  const [showForm, setShowForm] = createSignal(false);
  const [docUrl, setDocUrl] = createSignal("");
  const [toolId, setToolId] = createSignal("");

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const tid = toolId().trim();
    if (!tid) return;
    props.onSet(tid, docUrl().trim() || props.frameDocUrl);
    setShowForm(false);
    setDocUrl("");
    setToolId("");
  };

  return (
    <div class="tile-picker">
      {showForm() ? (
        <form class="tile-picker-form" onSubmit={handleSubmit}>
          <input
            class="tile-picker-input"
            type="text"
            placeholder="automerge:… (doc URL, optional)"
            value={docUrl()}
            onInput={(e) => setDocUrl(e.currentTarget.value)}
          />
          <input
            class="tile-picker-input"
            type="text"
            placeholder="tool-id"
            value={toolId()}
            onInput={(e) => setToolId(e.currentTarget.value)}
            autofocus
          />
          <div class="tile-picker-actions">
            <button
              type="button"
              class="tile-picker-btn tile-picker-btn--cancel"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              class="tile-picker-btn tile-picker-btn--open"
              disabled={!toolId().trim()}
            >
              Open
            </button>
          </div>
        </form>
      ) : (
        <div class="tile-picker-idle">
          <div class="tile-picker-quick">
            {QUICK_TOOLS.map((tool) => (
              <button
                class="tile-picker-quick-btn"
                onClick={() => props.onSet(tool.toolId, props.frameDocUrl)}
              >
                {tool.label}
              </button>
            ))}
          </div>
          <button class="tile-picker-manual" onClick={() => setShowForm(true)}>
            Open by URL…
          </button>
        </div>
      )}
    </div>
  );
}
