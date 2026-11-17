// the places a frame lets be followed, for following someone in the call
// (engine/follow.js). a frame opts a place in by marking it
// data-call-follow="<name>" (threepane's main view: "main"); nothing else is
// ever shared, and nowhere else follows. for each: what's open in it (the
// doc and tool of the view at its top, as that's mounted), and how it's
// being looked at, its view state: where it's scrolled to, a camera
//
// a tool asks for its view state with patchwork:view-state (as it does in
// lattice's panes), and is answered with a doc's url: one in the realm's
// scratch repo, never saved or synced. it reads and writes that doc, finding
// it with the repo it was given, and hears it change. yours goes to the
// call as it changes. while you follow someone, it's a copy of theirs the
// tool's shown under that same url (this answers repo:handle-descriptor for
// it, before anything further in can: drafts' answers every url), kept up
// to date, till you stop: then yours is wherever theirs got to
//
// following, what they've got open there opens here too, and a line in
// their colour goes round it, with who it is at the top: pressed, you stop.
// opening something else there yourself, you stop as well
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import html from "solid-js/html";
import * as providers from "@inkandswitch/patchwork-providers";
import { parseAutomergeUrl } from "@automerge/automerge-repo/slim";
import { openDocument } from "@inkandswitch/patchwork-elements";
import { call } from "./engine/call.js";
import { follow, following, holdArea, leaderView, shareView } from "./engine/follow.js";

export const AREA = "data-call-follow";
const VIEW = "patchwork-view";
const VIEW_STATE = "patchwork:view-state";
const DESCRIPTOR = "repo:handle-descriptor";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plain = (doc) => JSON.parse(JSON.stringify(doc ?? {}));
const bare = (url) => (typeof url === "string" ? url.split(/[#/]/, 1)[0] : "");
// whether a view of `url` in `toolId` is the one {url, toolId} says (a tool
// not said is any)
const isView = (view, url, toolId) =>
  !!view && bare(view.url) === bare(url) && (!view.toolId || !toolId || view.toolId === toolId);

/** `source` (plain) written over `target` (a doc being changed), touching only what differs. lists go whole */
export function copyInto(target, source) {
  for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (isObject(value) && isObject(target[key])) copyInto(target[key], value);
    else if (!same(target[key], value)) target[key] = value;
  }
}

/**
 * the place `event` is from, and the view at its top it's from:
 * {area, view}, or null. what's in a view inside that view isn't from it
 * (an embed's view state isn't the place's)
 */
function placeOf(event) {
  let view = null;
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue;
    if (node.hasAttribute(AREA)) return view ? { area: node, view } : null;
    if (node.localName === VIEW) {
      if (view) return null;
      view = node;
    }
  }
  return null;
}

/**
 * follow along in the places under `root` (the provider's element). returns
 * {Outlines (what to render: the line round each place while you follow),
 * stop()}
 */
export function followAreas(root) {
  // without a scratch repo (providers from before it), there's no view
  // state: what's open is still followed. it's only made once a tool asks
  const hasScratch = typeof providers.getScratchRepo === "function";
  const scratch = () => providers.getScratchRepo();

  // by element: {el, name, view, url, toolId, asking, asked, release}
  const areas = new Map();
  // the places, for drawing their lines
  const [shown, setShown] = createSignal([]);
  // by view: {area, view, mine, copy, showing, descriptors, subscribers, off}
  const panes = new Map();
  // by the documentId of a pane's own doc
  const byDoc = new Map();

  function areaFor(el) {
    let area = areas.get(el);
    if (area) return area;
    const name = el.getAttribute(AREA) || "main";
    area = { el, name, view: null, url: null, toolId: null, asking: null, asked: [], release: holdArea(name) };
    areas.set(el, area);
    setShown([...areas.values()]);
    return area;
  }
  function forgetArea(area) {
    area.release();
    areas.delete(area.el);
    setShown([...areas.values()]);
    shareView(area.name, null);
  }

  // ── what's yours, to the call ─────────────────────────────────────────

  function share(area) {
    if (!area.el.isConnected) return forgetArea(area);
    if (!area.url) return shareView(area.name, null);
    const pane = area.view && panes.get(area.view);
    shareView(area.name, { url: area.url, toolId: area.toolId, state: plain(pane?.mine.doc()) });
  }

  function onMounted(event) {
    const place = placeOf(event);
    const detail = event.detail ?? {};
    if (!place || typeof detail.url !== "string") return;
    const area = areaFor(place.area);
    area.view = place.view;
    area.url = bare(detail.url);
    area.toolId = typeof detail.toolId === "string" ? detail.toolId : null;
    if (isView(area.asking, area.url, area.toolId)) area.asking = null;
    // something else opened here, not by following: you're done following
    const theirs = following() && leaderView(area.name);
    const asked = area.asked.some((view) => isView(view, area.url, area.toolId));
    if (theirs && !isView(theirs, area.url, area.toolId) && !asked) follow(null);
    for (const other of [...areas.values()]) if (!other.el.isConnected) forgetArea(other);
    share(area);
    apply(area);
  }

  function onUnmounted(event) {
    const place = placeOf(event);
    const area = place && areas.get(place.area);
    if (!area || area.view !== place.view) return;
    area.view = null;
    area.url = null;
    area.toolId = null;
    share(area);
  }

  // ── following: theirs, here ───────────────────────────────────────────

  function apply(area) {
    const view = following() ? leaderView(area.name) : null;
    const theirs = view && { url: view.url, toolId: view.toolId, state: plain(view.state) };
    const here = !!theirs && isView(theirs, area.url, area.toolId);
    if (theirs && !here && !isView(area.asking, theirs.url, theirs.toolId)) {
      area.asking = { url: theirs.url, toolId: theirs.toolId };
      area.asked = [...area.asked, area.asking].slice(-8);
      openDocument(area.el, theirs.url, theirs.toolId || undefined);
    }
    for (const pane of panes.values()) {
      if (pane.area === area) show(pane, here && pane.view === area.view ? theirs.state : null);
    }
  }

  // ── view state ────────────────────────────────────────────────────────

  const descriptor = (pane) => ({ url: pane.mine.url, cloneUrl: pane.cloneUrl, scratchUrl: pane.showing.url });

  function show(pane, theirs) {
    let next = pane.mine;
    if (theirs) {
      pane.copy ??= scratch().create({});
      pane.copy.change((doc) => copyInto(doc, theirs));
      next = pane.copy;
    } else if (pane.copy && pane.showing === pane.copy) {
      // stopping: yours is where theirs got to
      const got = plain(pane.copy.doc());
      pane.mine.change((doc) => copyInto(doc, got));
    }
    if (next === pane.showing) return;
    pane.showing = next;
    for (const respond of pane.descriptors) respond(descriptor(pane));
  }

  function paneFor(area, view) {
    let pane = panes.get(view);
    if (pane) return pane;
    const mine = scratch().create({});
    pane = {
      area,
      view,
      mine,
      copy: null,
      showing: mine,
      cloneUrl: bare(view.getAttribute("doc-url")) || undefined,
      descriptors: new Set(),
      subscribers: 0,
    };
    const changed = () => {
      if (pane.area.view === view) share(pane.area);
    };
    mine.on("change", changed);
    pane.off = () => mine.off("change", changed);
    panes.set(view, pane);
    byDoc.set(mine.documentId, pane);
    if (pane.cloneUrl === undefined) delete pane.cloneUrl;
    apply(area);
    return pane;
  }

  function forgetPane(pane) {
    pane.off();
    panes.delete(pane.view);
    byDoc.delete(pane.mine.documentId);
    scratch().delete(pane.mine.url);
    if (pane.copy) scratch().delete(pane.copy.url);
  }

  // a tool in a place asking for its view state
  function onSubscribe(event) {
    if (event.detail?.selector?.type !== VIEW_STATE || !hasScratch) return;
    const place = placeOf(event);
    if (!place) return;
    const pane = paneFor(areaFor(place.area), place.view);
    pane.subscribers++;
    providers.accept(event, (respond) => {
      respond(pane.mine.url);
      return () => {
        if (--pane.subscribers <= 0) forgetPane(pane);
      };
    });
  }

  // its repo finding that doc: before anything further in hears it
  function onDescriptor(event) {
    const selector = event.detail?.selector;
    if (selector?.type !== DESCRIPTOR) return;
    let documentId;
    try {
      documentId = parseAutomergeUrl(selector.url).documentId;
    } catch {
      return;
    }
    const pane = byDoc.get(documentId);
    if (!pane) return;
    providers.accept(event, (respond) => {
      pane.descriptors.add(respond);
      respond(descriptor(pane));
      return () => pane.descriptors.delete(respond);
    });
  }

  root.addEventListener("patchwork:mounted", onMounted);
  root.addEventListener("patchwork:unmounted", onUnmounted);
  root.addEventListener("patchwork:subscribe", onSubscribe);
  root.addEventListener("patchwork:subscribe", onDescriptor, { capture: true });

  // what was there before this was (loaded late, or swapped in anew)
  for (const el of root.querySelectorAll(`[${AREA}]`)) {
    const view = [...el.querySelectorAll(`${VIEW}[doc-url]`)].find((view) => view.parentElement?.closest(`${VIEW}, [${AREA}]`) === el);
    const area = areaFor(el);
    if (view) {
      area.view = view;
      area.url = bare(view.getAttribute("doc-url"));
      area.toolId = view.getAttribute("tool-id");
      share(area);
    }
  }

  // ── the line round a place, while you follow ──────────────────────────

  function Outlines() {
    createEffect(() => {
      // whoever you follow, and what they've got open, as it changes
      following();
      for (const area of shown()) {
        // (all of it: it's the state in it that changes most)
        JSON.stringify(leaderView(area.name));
        apply(area);
      }
    });
    const leader = () => call.peers().find((peer) => peer.id === following()) ?? null;
    return html`<${Show} when=${following}>
      <${For} each=${shown}>
        ${(area) => html`<${Show} when=${() => !!leaderView(area.name)}><${Outline} area=${area} leader=${leader} /><//>`}
      <//>
    <//>`;
  }

  return {
    Outlines,
    stop() {
      root.removeEventListener("patchwork:mounted", onMounted);
      root.removeEventListener("patchwork:unmounted", onUnmounted);
      root.removeEventListener("patchwork:subscribe", onSubscribe);
      root.removeEventListener("patchwork:subscribe", onDescriptor, { capture: true });
      for (const pane of [...panes.values()]) forgetPane(pane);
      for (const area of [...areas.values()]) forgetArea(area);
    },
  };
}

const sameBox = (a, b) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/** where `el` is on screen, as it moves and changes size (in a reactive scope) */
function boxOf(el) {
  const [box, setBox] = createSignal(null, { equals: sameBox });
  let frame = 0;
  function measure() {
    frame = 0;
    if (!el.isConnected) return setBox(null);
    const { left, top, width, height } = el.getBoundingClientRect();
    setBox(width && height ? { left, top, width, height } : null);
  }
  const soon = () => (frame ||= requestAnimationFrame(measure));
  const sizes = new ResizeObserver(soon);
  sizes.observe(el);
  addEventListener("resize", soon);
  addEventListener("scroll", soon, true);
  measure();
  onCleanup(() => {
    cancelAnimationFrame(frame);
    sizes.disconnect();
    removeEventListener("resize", soon);
    removeEventListener("scroll", soon, true);
  });
  return box;
}

// their colour round the place, and who it is, hanging from the middle of
// its top: pressed, you stop
function Outline(props) {
  const box = boxOf(props.area.el);
  const name = () => props.leader?.name || "someone";
  return html`<${Show} when=${box}>
    <div
      class="patchwork-call-following"
      style=${() => ({
        left: `${box().left}px`,
        top: `${box().top}px`,
        width: `${box().width}px`,
        height: `${box().height}px`,
        "--call-following": props.leader?.colour || null,
      })}
    >
      <button class="patchwork-call-following-tag" title="stop following" onClick=${() => follow(null)}>
        following ${name}
      </button>
    </div>
  <//>`;
}
