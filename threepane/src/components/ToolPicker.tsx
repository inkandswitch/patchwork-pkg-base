import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import type { LaneItem } from "../layoutEdits";

const WIDTH = 220;

/**
 * A search box over a list of components, opened under `anchor`. Picks one of
 * the listed items, or, when what's typed isn't one of them, the typed text as
 * an id ("Add “…”", last). Closes on a pick, a click outside or Escape.
 */
export function ToolPicker(props: {
  anchor: DOMRect;
  items: LaneItem[];
  placeholder: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  let root!: HTMLDivElement;
  let input!: HTMLInputElement;
  let list!: HTMLDivElement;
  const [query, setQuery] = createSignal("");
  const [highlighted, setHighlighted] = createSignal(0);

  const rows = createMemo<(LaneItem & { typed?: true })[]>(() => {
    const q = query().trim();
    const lower = q.toLowerCase();
    const matches = props.items.filter(
      (item) =>
        !lower ||
        item.name.toLowerCase().includes(lower) ||
        item.id.toLowerCase().includes(lower)
    );
    const exact = props.items.some((item) => item.id === q);
    return q && !exact ? [...matches, { id: q, name: q, typed: true }] : matches;
  });

  function pick(id: string) {
    props.onClose();
    props.onPick(id);
  }

  function move(by: number) {
    const count = rows().length;
    if (!count) return;
    const next = (highlighted() + by + count) % count;
    setHighlighted(next);
    list.children[next]?.scrollIntoView({ block: "nearest" });
  }

  // Under the anchor, its right edge lined up with the anchor's if it would
  // otherwise run off the right of the screen.
  const left = () =>
    Math.max(
      4,
      props.anchor.left + WIDTH > innerWidth - 4
        ? props.anchor.right - WIDTH
        : props.anchor.left
    );

  onMount(() => {
    input.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) props.onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    onCleanup(() =>
      document.removeEventListener("pointerdown", onPointerDown, true)
    );
  });

  return (
    <Portal>
      <div
        ref={root}
        class="threepane-picker"
        // Solid's delegated events cross the portal back to the owner: keep a
        // right-click in the search box (for paste) from opening its menu.
        onContextMenu={(event) => event.stopPropagation()}
        style={{
          left: `${left()}px`,
          top: `${props.anchor.bottom + 2}px`,
          width: `${WIDTH}px`,
        }}
      >
        <input
          ref={input}
          class="threepane-picker__input"
          type="text"
          placeholder={props.placeholder}
          aria-label={props.placeholder}
          spellcheck={false}
          autocomplete="off"
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setHighlighted(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") move(1);
            else if (event.key === "ArrowUp") move(-1);
            else if (event.key === "Enter") {
              const row = rows()[highlighted()];
              if (row) pick(row.id);
            } else if (event.key === "Escape") props.onClose();
            else return;
            event.preventDefault();
          }}
        />
        <div ref={list} class="threepane-picker__list" role="listbox">
          <For each={rows()}>
            {(row, index) => (
              <button
                type="button"
                role="option"
                class="threepane-picker__item"
                aria-selected={index() === highlighted()}
                data-highlight={index() === highlighted() ? "" : undefined}
                onPointerEnter={() => setHighlighted(index())}
                onClick={() => pick(row.id)}
              >
                <Show
                  when={!row.typed}
                  fallback={<>Add “{row.id}”</>}
                >
                  <span>{row.name}</span>
                  <Show when={row.name !== row.id}>
                    <span class="threepane-picker__id">{row.id}</span>
                  </Show>
                </Show>
              </button>
            )}
          </For>
        </div>
      </div>
    </Portal>
  );
}
