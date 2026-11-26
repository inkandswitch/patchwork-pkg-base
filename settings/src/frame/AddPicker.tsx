import { createMemo, createSignal, For, Show } from "solid-js";
import { filterOptions, type LaneItem } from "./lanes";
import { placePopover } from "./place";

// "Add…", and a search over `options` that pops out of it, like the title
// bar's "Open with…". type to filter, arrows to move, enter to add. enter on
// something that matches nothing adds what you typed, as a tool id
export function AddPicker(props: {
  options: LaneItem[];
  onPick: (id: string) => void;
}) {
  let button!: HTMLButtonElement;
  let menu!: HTMLDivElement;
  let input!: HTMLInputElement;
  let list!: HTMLDivElement;
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [highlighted, setHighlighted] = createSignal(0);
  const matches = createMemo(() => filterOptions(props.options, query()));
  const typed = () => query().trim();

  function pick(id: string) {
    menu.hidePopover();
    props.onPick(id);
  }

  function highlight(index: number) {
    setHighlighted(index);
    list.children[index]?.scrollIntoView({ block: "nearest" });
  }

  function place() {
    placePopover(menu, button, { width: 220 });
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        class="settings-button"
        aria-haspopup="listbox"
        aria-expanded={open()}
        data-open={open() ? "" : undefined}
        onClick={() => {
          if (!open()) {
            setQuery("");
            setHighlighted(0);
            place();
          }
          menu.togglePopover();
        }}
      >
        Add…
      </button>
      <div
        ref={menu}
        popover="auto"
        class="settings-picker"
        on:toggle={(event: ToggleEvent) => {
          setOpen(event.newState === "open");
          if (event.newState === "open") input.focus();
        }}
      >
        <input
          ref={input}
          class="settings-picker-input"
          placeholder="Add or filter tools…"
          aria-label="Add or filter tools"
          spellcheck={false}
          autocomplete="off"
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setHighlighted(0);
          }}
          onKeyDown={(event) => {
            const count = matches().length;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              highlight(Math.min(highlighted() + 1, count - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              highlight(Math.max(highlighted() - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const match = matches()[highlighted()];
              if (match) pick(match.id);
              else if (typed()) pick(typed());
            }
          }}
        />
        <div ref={list} class="settings-picker-list" role="listbox">
          <For each={matches()}>
            {(option, index) => (
              <button
                type="button"
                role="option"
                class="settings-picker-item"
                aria-selected={highlighted() === index()}
                data-highlight={highlighted() === index() ? "" : undefined}
                onPointerEnter={() => setHighlighted(index())}
                onClick={() => pick(option.id)}
              >
                {option.name}
              </button>
            )}
          </For>
          <Show when={!matches().length}>
            <Show
              when={typed()}
              fallback={
                <p class="settings-picker-empty">
                  {props.options.length
                    ? "Nothing matches"
                    : "Everything's already here. Type a tool id to add another."}
                </p>
              }
            >
              <button
                type="button"
                role="option"
                class="settings-picker-item"
                data-highlight=""
                onClick={() => pick(typed())}
              >
                Add <code class="settings-code">{typed()}</code>
              </button>
            </Show>
          </Show>
        </div>
      </div>
    </>
  );
}
