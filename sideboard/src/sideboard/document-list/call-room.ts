// Which doc your call is in, so its row can say so (a little phone). Asked
// once for the whole list, of the call provider (the call package's
// `patchwork:call-now`), not row by row: asking about a doc makes the call
// listen in on it, and a list can have thousands. With no call package,
// nothing answers and no row has a phone.
import {
  createContext,
  createMemo,
  createSelector,
  createSignal,
  onCleanup,
  useContext,
} from "solid-js";
import { subscribe } from "@inkandswitch/patchwork-providers-solid";

const PROVIDER = "call-provider";
const CALL_NOW = "patchwork:call-now";

/** a doc url without its heads or path: every version of a doc is its room */
export const bare = (url: string) => url.split(/[#/]/, 1)[0];

/**
 * whether `url` is the doc your call's in, asked by `element` (in a reactive
 * scope: a selector, so a row hears only its own change). a provider that
 * turns up after this asked (loaded late, or swapped in anew) is asked again
 */
export function createCallRoom(element: HTMLElement) {
  const [asked, setAsked] = createSignal(0);
  const again = (event: Event) => {
    if ((event as CustomEvent).detail?.componentId === PROVIDER) setAsked((n) => n + 1);
  };
  addEventListener("patchwork:mounted", again);
  onCleanup(() => removeEventListener("patchwork:mounted", again));

  // (each ask is its own subscription, let go when it's asked again)
  const answer = createMemo(() => {
    asked();
    return subscribe<{ room?: unknown } | null>(element, { type: CALL_NOW }, null);
  });
  const room = createMemo(() => {
    const room = answer()()?.room;
    return typeof room === "string" && room ? bare(room) : null;
  });
  return createSelector(room, (url: string, room) => !!room && bare(url) === room);
}

/** whether `url` is the doc your call's in (false outside a list) */
export const CallRoom = createContext<(url: string) => boolean>(() => false);
export const useCallRoom = () => useContext(CallRoom);
