import { createSignal } from "solid-js";
import { placePopover } from "./place";

// a strip item's ×: a little menu off it, to hide (or show) the tool or take
// it out. arrows move between the two, Escape closes it
export function ItemMenu(props: {
  name: string;
  hidden?: boolean;
  onHidden: (hidden: boolean) => void;
  onRemove: () => void;
}) {
  let button!: HTMLButtonElement;
  let menu!: HTMLDivElement;
  const [open, setOpen] = createSignal(false);

  function choose(fn: () => void) {
    menu.hidePopover();
    fn();
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        class="settings-strip-icon"
        aria-label={`${props.name}: hide or remove`}
        aria-haspopup="menu"
        aria-expanded={open()}
        data-open={open() ? "" : undefined}
        onClick={() => {
          if (!open()) placePopover(menu, button, { width: 120, height: 80 });
          menu.togglePopover();
        }}
      >
        ×
      </button>
      <div
        ref={menu}
        popover="auto"
        role="menu"
        aria-label={props.name}
        class="settings-menu"
        on:toggle={(event: ToggleEvent) => {
          setOpen(event.newState === "open");
          if (event.newState === "open")
            menu.querySelector<HTMLButtonElement>("button")?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const items = [...menu.querySelectorAll<HTMLButtonElement>("button")];
          const at = items.indexOf(document.activeElement as HTMLButtonElement);
          const by = event.key === "ArrowDown" ? 1 : -1;
          items[(at + by + items.length) % items.length]?.focus();
        }}
      >
        <button
          type="button"
          role="menuitem"
          class="settings-menu-item"
          onClick={() => choose(() => props.onHidden(!props.hidden))}
        >
          {props.hidden ? "Show" : "Hide"}
        </button>
        <button
          type="button"
          role="menuitem"
          class="settings-menu-item"
          data-danger
          onClick={() => choose(props.onRemove)}
        >
          Remove
        </button>
      </div>
    </>
  );
}
