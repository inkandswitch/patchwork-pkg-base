// picture in picture, as meet has it: the call in a little window of its
// own, over everything, while you're somewhere else. opened from the call
// bar, or by itself as you leave the tab (the browser asks the page, through
// its media session, while it's using a camera or mic). everyone else's
// faces, you in the corner, and your mic, camera and hanging up; a screen
// being shared fills it. it closes as the call ends, and one that opened by
// itself closes as you come back to the tab
//
// it's a window of its own (the document picture-in-picture api: chrome's),
// so it's drawn there with the page's styles and theme copied in, and solid
// told to hear its events (they're heard on a document, and this isn't the
// page's)
import { createEffect, createRoot, For, on, onCleanup, Show } from "solid-js";
import { clearDelegatedEvents, delegateEvents, DelegatedEvents, render } from "solid-js/web";
import html from "solid-js/html";
import { call, hangUp, setCamera, setMic } from "../engine/call.js";
import { pipWindow, setPipWindow } from "../engine/pip.js";
import { Face, Picture } from "./ui.js";
import { icon } from "./icons.js";

// to start with: a little 4:3, as meet's is
const WIDTH = 360;
const HEIGHT = 290;

/** whether there's picture in picture here */
export const canPip = () => typeof globalThis.documentPictureInPicture?.requestWindow === "function";

/** whether it's open */
export const pipOpen = () => !!pipWindow();

let opening = null;

/**
 * open it, while you're in a call (it's the window it's in, or null).
 * `auto`: the browser asked, as you left the tab, so it closes as you come
 * back. `from`: an element whose theme it takes
 */
export function openPip({ auto = false, from = document.documentElement } = {}) {
  if (!canPip() || !call.get()) return Promise.resolve(null);
  if (pipWindow()) return Promise.resolve(pipWindow());
  opening ??= (async () => {
    let win;
    try {
      win = await globalThis.documentPictureInPicture.requestWindow({ width: WIDTH, height: HEIGHT });
    } catch (error) {
      // (no click to open it with, or it's not allowed here)
      console.warn("[call] couldn't open picture in picture", error);
      return null;
    }
    // hung up while it was opening
    if (!call.get()) {
      win.close();
      return null;
    }
    show(win, { auto, from });
    return win;
  })().finally(() => (opening = null));
  return opening;
}

/** close it, if it's open */
export function closePip() {
  pipWindow()?.close();
}

// the call in `win`, till it's closed
function show(win, { auto, from }) {
  const doc = win.document;
  const undress = dress(doc, from);
  doc.body.dataset.callPip = "";
  delegateEvents([...DelegatedEvents], doc);
  const dispose = render(() => {
    createEffect(() => (doc.title = call.nameOf(call.get()?.room) || "call"));
    return html`<${CallPip} />`;
  }, doc.body);
  // opened as you left: closed as you're back
  const onBack = () => auto && document.visibilityState === "visible" && win.close();
  document.addEventListener("visibilitychange", onBack);
  win.addEventListener(
    "pagehide",
    () => {
      document.removeEventListener("visibilitychange", onBack);
      dispose();
      clearDelegatedEvents(doc);
      undress();
      if (pipWindow() === win) setPipWindow(null);
    },
    { once: true },
  );
  setPipWindow(win);
}

// `doc` dressed as the page is: its stylesheets, its root's attributes (the
// theme's chosen there), and every custom property as `from` has it, so
// whatever the theme is set on, it's the same. again as the theme changes.
// returns a way to stop
function dress(doc, from) {
  const page = from.ownerDocument ?? document;
  for (const sheet of [...page.styleSheets, ...(page.adoptedStyleSheets ?? [])]) {
    try {
      const style = doc.createElement("style");
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
      if (sheet.media?.mediaText) style.media = sheet.media.mediaText;
      doc.head.append(style);
    } catch {
      // (another origin's: it can't be read, only linked to)
      if (!sheet.href) continue;
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      doc.head.append(link);
    }
  }
  const root = doc.documentElement;
  const again = () => {
    for (const { name, value } of page.documentElement.attributes) {
      if (name !== "style") root.setAttribute(name, value);
    }
    const computed = getComputedStyle(from);
    for (let i = 0; i < computed.length; i++) {
      const name = computed[i];
      if (name.startsWith("--")) root.style.setProperty(name, computed.getPropertyValue(name));
    }
    root.style.colorScheme = computed.colorScheme ?? "";
  };
  again();
  const watching = new MutationObserver(again);
  watching.observe(page.documentElement, { attributes: true });
  return () => watching.disconnect();
}

/**
 * while you're in a call, the browser can open it as you leave the tab
 * (`from`: whose theme it takes). out of one, it's closed. returns a way to
 * stop, which closes it too
 */
export function holdPip(from) {
  const offer = (handler) => {
    try {
      navigator.mediaSession?.setActionHandler("enterpictureinpicture", handler);
    } catch {
      // (a browser that doesn't know it)
    }
  };
  return createRoot((dispose) => {
    createEffect(
      on(
        () => !!call.get(),
        (inCall) => {
          if (!inCall) return closePip();
          if (!canPip()) return;
          offer(() => openPip({ auto: true, from }));
          onCleanup(() => offer(null));
        },
      ),
    );
    return () => {
      dispose();
      closePip();
    };
  });
}

/**
 * the call, in the window: a screen being shared, or everyone else's faces
 * as many across as down; you in the corner (alone, you fill it); and your
 * mic, camera and hanging up
 */
export function CallPip() {
  const others = () => call.peers();
  const alone = () => others().length === 0;
  const sharing = () => others().find((peer) => call.screen(peer.id))?.id ?? null;
  const columns = () => Math.ceil(Math.sqrt(Math.max(1, others().length)));
  const mic = () => !!call.get()?.mic;
  const camera = () => !!call.get()?.camera;

  const Tile = (peer) => html`<div class="patchwork-call-pip-tile">
    <${Face} id=${peer.id} shape="tile" muted=${false} title=${false} />
    <span class="patchwork-call-pip-name">
      <span class="patchwork-call-pip-name-text">${() => peer.name}</span>
      <${Show} when=${() => !peer.mic}><span aria-label="muted">${icon("mic-off", 11)}</span><//>
    </span>
  </div>`;

  return html`<div class="patchwork-call-pip" data-alone=${() => (alone() ? "" : undefined)}>
    <div class="patchwork-call-pip-main">
      <${Show}
        when=${sharing}
        keyed
        fallback=${html`<div class="patchwork-call-pip-grid" style=${() => ({ "--columns": String(columns()) })}>
          <${For} each=${others}>${Tile}<//>
        </div>`}
      >
        ${(id) => html`<div class="patchwork-call-pip-screen"><${Picture} id=${id} /></div>`}
      <//>
      <div class="patchwork-call-pip-me">
        <${Face} id="me" shape="tile" muted=${false} title=${false} />
        <${Show} when=${alone}>
          <span class="patchwork-call-pip-name"><span class="patchwork-call-pip-name-text">no one else here yet</span></span>
        <//>
      </div>
    </div>
    <div class="patchwork-call-pip-bar" role="toolbar" aria-label="the call">
      <button
        class="patchwork-call-pip-button"
        data-off=${() => (mic() ? undefined : "")}
        title=${() => (mic() ? "mute" : "unmute")}
        aria-label=${() => (mic() ? "mute" : "unmute")}
        onClick=${() => setMic(!mic())}
      >
        ${() => icon(mic() ? "mic" : "mic-off", 16)}
      </button>
      <button
        class="patchwork-call-pip-button"
        data-off=${() => (camera() ? undefined : "")}
        title=${() => (camera() ? "camera off" : "camera on")}
        aria-label=${() => (camera() ? "camera off" : "camera on")}
        onClick=${() => setCamera(!camera())}
      >
        ${() => icon(camera() ? "video" : "video-off", 16)}
      </button>
      <button class="patchwork-call-pip-button patchwork-call-pip-hang-up" title="hang up" aria-label="hang up" onClick=${hangUp}>
        ${icon("hang-up", 16)}
      </button>
    </div>
  </div>`;
}
