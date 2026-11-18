import { EditorView } from "@codemirror/view";

/**
 * A small popup menu of buttons, shared by the list marker menu (lists.ts)
 * and the heading level menu (headings.ts). Up and Down move through it,
 * Enter or a click picks, Escape or a click outside closes it.
 */

export type MenuItem = {
  label: string;
  run: () => void;
  disabled?: boolean;
  /** set for a choice among several (a heading's level): ticked or not */
  checked?: boolean;
};

export type MenuOptions = {
  /** the entry focused when it opens; the first enabled one otherwise */
  focus?: number;
  /** a key the menu doesn't handle itself: return true to take it */
  onKey?: (event: KeyboardEvent, close: () => void) => boolean;
  /** after it closes, however it closes */
  onClose?: () => void;
};

export function openMenu(
  view: EditorView,
  x: number,
  y: number,
  entries: MenuItem[],
  options: MenuOptions = {}
) {
  const menu = document.createElement("div");
  menu.className = "cm-md-menu";
  menu.setAttribute("role", "menu");
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const buttons = entries.map(({ label, run, disabled, checked }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cm-md-menu-item";
    b.textContent = label;
    b.disabled = !!disabled;
    if (checked === undefined) b.setAttribute("role", "menuitem");
    else {
      b.setAttribute("role", "menuitemradio");
      b.setAttribute("aria-checked", String(checked));
    }
    b.addEventListener("click", () => {
      close();
      run();
      view.focus();
    });
    return b;
  });
  menu.append(...buttons);

  const outside = (e: Event) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const keys = (e: KeyboardEvent) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      view.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      const live = buttons.filter((b) => !b.disabled);
      const at = live.indexOf(buttons[i]);
      live[(at + step + live.length) % live.length]?.focus();
    } else if (options.onKey?.(e, close)) {
      e.preventDefault();
    }
  };
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (menu.matches?.(":popover-open")) menu.hidePopover();
    menu.remove();
    window.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("blur", close);
    menu.removeEventListener("keydown", keys);
    options.onClose?.();
  }
  window.addEventListener("pointerdown", outside, true);
  window.addEventListener("scroll", close, true);
  window.addEventListener("blur", close);
  menu.addEventListener("keydown", keys);

  view.dom.appendChild(menu);
  // In the top layer, so nothing the editor sits in can move it (a
  // transformed or contained ancestor makes `position: fixed` relative to
  // itself), clip it, or draw over it (the app's side panels did all three).
  if (typeof menu.showPopover === "function") {
    menu.popover = "manual";
    menu.showPopover();
  }
  // where it actually landed, put right: covers browsers without popovers.
  let r = menu.getBoundingClientRect();
  if (r.left !== x || r.top !== y) {
    menu.style.left = `${x + (x - r.left)}px`;
    menu.style.top = `${y + (y - r.top)}px`;
    r = menu.getBoundingClientRect();
  }
  // and on screen
  const shift = (prop: "left" | "top", by: number) =>
    (menu.style[prop] = `${parseFloat(menu.style[prop]) - by}px`);
  if (r.right > window.innerWidth) shift("left", r.width);
  if (r.bottom > window.innerHeight) shift("top", r.height);
  const first = options.focus ?? buttons.findIndex((b) => !b.disabled);
  buttons[first]?.focus();
  return close;
}

export const menuTheme = EditorView.baseTheme({
  ".cm-md-menu": {
    position: "fixed",
    // undo the popover defaults (centred, inset 0)
    inset: "auto",
    margin: "0",
    zIndex: "var(--studio-layer-popover, 4000)",
    display: "flex",
    flexDirection: "column",
    minWidth: "12rem",
    padding: "4px",
    borderRadius: "6px",
    background: "var(--studio-fill, white)",
    color: "var(--studio-line, black)",
    border:
      "var(--studio-border-width, 1px) var(--studio-border-style, solid) var(--studio-fill-offset-30, #ddd)",
    boxShadow: "var(--studio-shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1))",
    fontFamily: "var(--studio-family-ui, system-ui, sans-serif)",
    fontSize: "0.8rem",
  },
  ".cm-md-menu-item": {
    all: "unset",
    padding: "8px 12px",
    borderRadius: "4px",
    cursor: "var(--studio-cursor-default, default)",
  },
  ".cm-md-menu-item:disabled": {
    opacity: "0.45",
  },
  ".cm-md-menu-item:not(:disabled):hover, .cm-md-menu-item:focus-visible": {
    background: "var(--studio-fill-offset-20, #eee)",
  },
  // a ticked choice: a check before it, its room kept on the others
  ".cm-md-menu-item[role=menuitemradio]::before": {
    content: '""',
    display: "inline-block",
    width: "1.2em",
  },
  ".cm-md-menu-item[aria-checked=true]::before": {
    content: '"✓"',
  },
});
