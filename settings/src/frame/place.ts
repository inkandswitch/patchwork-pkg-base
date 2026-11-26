// put a popover next to the button that opens it: under it, or over it when
// there's more room there and not enough under, and no taller than the room
// it gets. lined up with the button's left edge, or its right edge when that
// would run off the page
export function placePopover(
  menu: HTMLElement,
  button: HTMLElement,
  { width = 0, height = 260 } = {}
) {
  const rect = button.getBoundingClientRect();
  const w = Math.max(rect.width, width);
  const gap = 2;
  const margin = 8;
  const below = window.innerHeight - rect.bottom - gap - margin;
  const above = rect.top - gap - margin;
  const up = below < height && above > below;

  if (up) {
    menu.style.top = "";
    menu.style.bottom = `${window.innerHeight - rect.top + gap}px`;
  } else {
    menu.style.bottom = "";
    menu.style.top = `${rect.bottom + gap}px`;
  }
  menu.style.maxHeight = `${Math.max(0, up ? above : below)}px`;
  menu.style.minWidth = `${w}px`;

  const right = rect.left + w > window.innerWidth - margin;
  if (right) {
    menu.style.left = "";
    menu.style.right = `${window.innerWidth - rect.right}px`;
  } else {
    menu.style.right = "";
    menu.style.left = `${rect.left}px`;
  }
  menu.style.transformOrigin = `${up ? "bottom" : "top"} ${right ? "right" : "left"}`;
}
