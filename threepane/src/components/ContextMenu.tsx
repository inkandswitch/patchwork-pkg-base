import { For, Match, onCleanup, onMount, Switch } from "solid-js";
import { Portal } from "solid-js/web";

export type MenuEntry =
  | { label: string; onSelect: () => void }
  | { heading: string }
  | "separator";

export type MenuAt = { x: number; y: number };

/**
 * A right-click menu at a point, portalled to the body so no scroll container
 * clips it. Closes on a pick, a click outside, Escape, or the window losing
 * focus; arrow keys move between items.
 */
export function ContextMenu(props: {
  at: MenuAt;
  label: string;
  entries: MenuEntry[];
  onClose: () => void;
}) {
  let menu!: HTMLDivElement;

  onMount(() => {
    // Kept on screen: flipped back from the right and bottom edges once its
    // size is known.
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(props.at.x, innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(props.at.y, innerHeight - rect.height - 4))}px`;
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    const onBlur = () => props.onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    });
  });

  return (
    <Portal>
      <div
        ref={menu}
        class="threepane-menu"
        role="menu"
        aria-label={props.label}
        style={{ left: `${props.at.x}px`, top: `${props.at.y}px` }}
        // Solid's delegated events cross the portal back to the owner, which
        // would reopen this menu under the pointer.
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          const items = [
            ...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
          ];
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement
          );
          const focus = (next: number) =>
            items[(next + items.length) % items.length]?.focus();
          if (event.key === "ArrowDown") focus(index + 1);
          else if (event.key === "ArrowUp")
            focus(index < 0 ? items.length - 1 : index - 1);
          else return;
          event.preventDefault();
        }}
      >
        <For each={props.entries}>
          {(entry) => (
            <Switch>
              <Match when={entry === "separator"}>
                <hr class="threepane-menu__separator" />
              </Match>
              <Match when={typeof entry === "object" && "heading" in entry && entry}>
                {(heading) => (
                  <div class="threepane-menu__heading">{heading().heading}</div>
                )}
              </Match>
              <Match when={typeof entry === "object" && "label" in entry && entry}>
                {(item) => (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      props.onClose();
                      item().onSelect();
                    }}
                  >
                    {item().label}
                  </button>
                )}
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </Portal>
  );
}

/** Copy `text`, quietly: a refused clipboard isn't worth an error. */
export function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch((error) => {
    console.warn("threepane: couldn't copy", error);
  });
}
