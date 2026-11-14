// what's new: a face, a call that turns up while you're looking
// comes in (styles.css's [data-arriving]), and what was there when you came,
// or came with the first sync a moment after, is just there. opening a
// doc shouldn't have everything in it arrive. and it's new once: a row
// that's made again (its list worked out afresh) isn't arriving
import { onCleanup } from "solid-js";

// how long the first sync has to bring what was already there
const SETTLES_AFTER = 1500;

/**
 * call where the list is made; then, as each thing in it is, `arriving(key)`
 * is "" for data-arriving (the first time that key's seen, once it's
 * settled) or undefined
 */
export function arrivals(after = SETTLES_AFTER) {
  let settled = false;
  const seen = new Set();
  const timer = setTimeout(() => (settled = true), after);
  onCleanup(() => clearTimeout(timer));
  return (key) => {
    const fresh = !seen.has(key);
    seen.add(key);
    return settled && fresh ? "" : undefined;
  };
}
