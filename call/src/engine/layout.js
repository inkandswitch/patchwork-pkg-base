// where a call's faces are in the docs it's looking at (a canvas, say): an
// automerge doc made for the call, which the call agrees on over its channel
// (see docs/superpowers/specs/2026-11-17-call-canvas-faces-design.md)
//
//   {spots: {"<room>|<person>": {x, y, size}}}
//
// flat keys, so two people placing different faces never write the same map
// (two `spots[room] = {}` made at once would drop one of them)
import { createSignal } from "solid-js";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";

const MIN_SIZE = 24;
const MAX_SIZE = 4000;

/** the key a person's face on `room` is kept by */
export const spotKey = (room, person) => `${room}|${person}`;

/** a spot as said, made safe: {x, y, size}, or null */
export function spotFrom(value) {
  if (!value || typeof value !== "object") return null;
  const { x, y, size } = value;
  if (![x, y, size].every(Number.isFinite)) return null;
  return { x, y, size: Math.min(MAX_SIZE, Math.max(MIN_SIZE, size)) };
}

/** a layout url said by someone, or null */
export function layoutFrom(value) {
  return typeof value === "string" && isValidAutomergeUrl(value) ? value : null;
}

/** of two layout urls, either of which may be missing, the one to keep */
export const lowest = (a, b) => (a && b ? (a <= b ? a : b) : (a ?? b ?? null));

/** copy what `from` has that `into` hasn't (`into` wins where both have it) */
export function mergeSpots(from, into) {
  const have = into.doc()?.spots ?? {};
  const missing = Object.entries(from.doc()?.spots ?? {}).filter(([key]) => !(key in have));
  if (!missing.length) return;
  into.change((doc) => {
    doc.spots ??= {};
    for (const [key, spot] of missing) doc.spots[key] = { x: spot.x, y: spot.y, size: spot.size };
  });
}

/**
 * the layout a session works with. `repo`: the page's. `onUrl()`: called when
 * the url it holds changes, so it can be said straight away
 */
export function createLayout({ repo, onUrl = () => {} }) {
  const [url, setUrl] = createSignal(null);
  const [spots, setSpots] = createSignal({});
  let handle = null;
  let unwatch = null;
  let closed = false;
  // finding a doc that was said: {url, done}
  let adopting = null;

  function use(next) {
    unwatch?.();
    handle = next;
    const read = () => setSpots({ ...(handle.doc()?.spots ?? {}) });
    handle.on("change", read);
    unwatch = () => handle.off("change", read);
    setUrl(handle.url);
    read();
    onUrl();
  }

  async function adopt(theirs) {
    let next;
    try {
      next = await repo.find(theirs);
    } catch (error) {
      console.warn(`[call] couldn't find the layout ${theirs}`, error);
      return;
    }
    // something lower came while it was being found, or the call ended
    if (closed || (url() && url() <= theirs)) return;
    const old = handle;
    if (old) mergeSpots(old, next);
    use(next);
  }

  return {
    url,
    spots,
    /** a layout url was said: take it, if it sorts lower than what's held */
    hear(said) {
      const theirs = layoutFrom(said);
      if (closed || !theirs || !repo) return;
      if (lowest(url(), theirs) === url()) return;
      if (adopting && adopting.url <= theirs) return;
      const mine = { url: theirs, done: null };
      adopting = mine;
      mine.done = adopt(theirs).finally(() => {
        if (adopting === mine) adopting = null;
      });
      return mine.done;
    },
    /** the layout's handle, making a layout if there's none (after one that's being found) */
    async ensure() {
      while (adopting) await adopting.done;
      if (closed) return null;
      if (!handle) use(repo.create({ spots: {} }));
      return handle;
    },
    /** put (or, with `spot` null, take away) spots: {[key]: spot | null} */
    async set(changes) {
      const writes = Object.entries(changes).map(([key, spot]) => [key, spot === null ? null : (spotFrom(spot) ?? undefined)]);
      if (writes.some(([, spot]) => spot === undefined)) return;
      const target = writes.some(([, spot]) => spot) ? await this.ensure() : handle;
      if (!target) return;
      target.change((doc) => {
        doc.spots ??= {};
        for (const [key, spot] of writes) {
          if (spot) doc.spots[key] = spot;
          else delete doc.spots[key];
        }
      });
    },
    close() {
      closed = true;
      unwatch?.();
      unwatch = null;
    },
  };
}
