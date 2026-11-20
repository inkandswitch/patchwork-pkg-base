// the call's picture-in-picture window (ui/pip.js), while it's open: for
// what's shown there to count as seen, and you as looking, with the tab
// hidden behind it
import { createSignal } from "solid-js";

const [open, setOpen] = createSignal(null);
const watchers = new Set();

/** the window, or null */
export const pipWindow = open;

/** it's open (`win`), or it's not (null) */
export function setPipWindow(win) {
  setOpen(() => win);
  for (const watcher of [...watchers]) watcher(win);
}

/** `fn` hears each time it opens or closes. returns a way to stop */
export function onPipChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}
