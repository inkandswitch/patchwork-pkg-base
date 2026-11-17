// following someone in your call: what they've got open in each place a
// frame lets be followed (data-call-follow, see follow-area.js: threepane's
// main view), and how they're looking at it there (its view state: where
// it's scrolled to, a camera), shows in yours till you stop. made from
// lattice's following (its wm), which follows a whole workspace of panes:
// here it's each place a frame opts in, by name
//
// what's said of it goes over the call's room with everything else
// (call.js): {views: {[area]: {url, toolId, state}}, following}, in "here"
// and, as it changes, on its own ("views"). you say nothing of your own
// views while you follow someone, and following someone who starts
// following someone else, you stop: you'd only be seeing their copy of
// someone else's, and two following each other would see nothing at all
import { createRoot, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { lasting } from "./lasting.js";

// your views, to everyone, at most this often (ms)
export const SHARE_EVERY = 50;
// whoever you follow, gone (a reload, say), is waited for this long to come
// back as another tab of theirs (the same contact)
export const FOLLOW_GRACE = 10_000;
// a view state bigger than this (as json) isn't said
const MOST = 32 * 1024;

const string = (value) => (value == null ? "" : String(value));
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const f = lasting("patchwork-call:follow", () =>
  createRoot(() => {
    // yours, by area: {url, toolId, state}
    const [mine, setMine] = createStore({});
    // everyone else's, by their id in the call: {views, following, contact}
    const [theirs, setTheirs] = createStore({});
    // who you follow: {id, contact}, and once they've gone, {lostAt, last}
    // (their views as they were) till they're back or it's too long
    const [leading, setLeading] = createSignal(null);
    // how many places here can follow, by area name
    const [areas, setAreas] = createStore({});
    return { mine, setMine, theirs, setTheirs, leading, setLeading, areas, setAreas, hooks: null, timer: null, grace: null };
  }),
);

/**
 * call.js's part: `send(news)` says {views, following} to the call (nothing,
 * outside one)
 */
export function connectFollow(hooks) {
  f.hooks = hooks;
}

/** a view as said: {url, toolId, state}, or null if it isn't one */
export function viewFrom(value) {
  if (!isObject(value)) return null;
  const url = string(value.url);
  if (!isValidAutomergeUrl(url)) return null;
  const state = isObject(value.state) ? value.state : {};
  if (JSON.stringify(state).length > MOST) return { url, toolId: string(value.toolId), state: {} };
  return { url, toolId: string(value.toolId), state: plain(state) };
}

function viewsFrom(value) {
  const views = {};
  if (!isObject(value)) return views;
  for (const [area, view] of Object.entries(value)) {
    const read = viewFrom(view);
    if (read) views[area] = read;
  }
  return views;
}

/** what's said of following, in "here" and "views" */
export function followNews() {
  const lead = following();
  return { views: lead ? {} : plain(f.mine), following: lead };
}

function shareNow() {
  clearTimeout(f.timer);
  f.timer = null;
  f.hooks?.send(followNews());
}
function shareSoon() {
  f.timer ??= setTimeout(shareNow, SHARE_EVERY);
}

/** your view in `area` changed: {url, toolId, state}, or null once there's nothing there */
export function shareView(area, view) {
  const read = viewFrom(view);
  if (same(f.mine[area], read)) return;
  f.setMine(area, read ? reconcile(read) : undefined);
  if (!following()) shareSoon();
}

/**
 * what someone in the call (`id`, who's `contact`) said: anything with
 * views in it ("here", "views"). whoever you follow starting to follow
 * someone, you stop; the one you followed back as another tab of theirs,
 * it's that one you follow
 */
export function heardViews(id, contact, message) {
  if (!isObject(message) || !("views" in message) || !id) return;
  const news = { views: viewsFrom(message.views), following: string(message.following) || null, contact: string(contact) };
  f.setTheirs(id, reconcile(news));
  const lead = f.leading();
  if (!lead) return;
  if (lead.id === id) {
    if (news.following) follow(null);
    return;
  }
  if (lead.lostAt && lead.contact && lead.contact === news.contact && !news.following) {
    clearTimeout(f.grace);
    f.setLeading({ id, contact: lead.contact });
  }
}

/** someone's gone from the call. if it's who you follow, they're waited for a while */
export function forgetViews(id) {
  const lead = f.leading();
  if (lead?.id === id && !lead.lostAt) {
    f.setLeading({ ...lead, lostAt: Date.now(), last: plain(f.theirs[id] ?? {}) });
    clearTimeout(f.grace);
    f.grace = setTimeout(() => {
      if (f.leading()?.lostAt) follow(null);
    }, FOLLOW_GRACE);
  }
  f.setTheirs(id, undefined);
}

/** follow `id` (someone in the call), or stop (null, or whoever you follow already) */
export function follow(id) {
  const lead = f.leading();
  clearTimeout(f.grace);
  if (!id || lead?.id === id) f.setLeading(null);
  else f.setLeading({ id, contact: f.theirs[id]?.contact ?? "" });
  if (string(lead?.id) !== string(f.leading()?.id)) shareNow();
}

/** who you follow (their id in the call), or null */
export const following = () => f.leading()?.id ?? null;

/** what whoever you follow has in `area`: {url, toolId, state}, or null */
export function leaderView(area) {
  const lead = f.leading();
  if (!lead) return null;
  const views = lead.lostAt ? lead.last?.views : f.theirs[lead.id]?.views;
  return views?.[area] ?? null;
}

/** whether there's anything of `id`'s to follow here: they've a view in a place you can follow */
export const canFollow = (id) => Object.keys(f.theirs[id]?.views ?? {}).some((area) => (f.areas[area] ?? 0) > 0);

/** a place here that can follow, called `area`, till it's let go */
export function holdArea(area) {
  f.setAreas(area, (n) => (n ?? 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    f.setAreas(area, (n) => Math.max(0, (n ?? 1) - 1));
  };
}

/** hung up: nobody followed, nothing heard */
export function resetFollow() {
  clearTimeout(f.grace);
  clearTimeout(f.timer);
  f.timer = null;
  f.setLeading(null);
  f.setTheirs(reconcile({}));
}
