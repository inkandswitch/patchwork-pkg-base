// the call provider: put round a frame (threepane mounts it round everything)
// it hears every doc mounted inside it, answers the protocol (protocol.js),
// and draws what floats
import { createEffect, createRoot } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { accept } from "@inkandswitch/patchwork-providers";
import {
  ask,
  call,
  hangUp,
  hearRoom,
  holdVideoSpot,
  onMic,
  setCamera,
  setDevice,
  setFaces,
  setHint,
  setMic,
  setNoise,
  setPrefer,
  setQuality,
  startScreen,
  stopScreen,
  toggleSharp,
} from "./engine/call.js";
import { roomUrl } from "./engine/room.js";
import {
  CALL,
  CALL_CONTROLS,
  CALL_EVENT,
  CALL_MEDIA,
  CALL_MIC,
  CALL_NOW,
  CALL_ROOM,
  CALL_VIDEO,
  roomState,
} from "./protocol.js";
import { CallFloating, CallQuestion, CallStage } from "./ui/ui.js";
import { stageArea } from "./ui/area.js";
import { chimes } from "./engine/chimes.js";
import "./ui/styles.css";

/** answer `event` with `read()` now and whenever it changes, till it's unsubscribed */
function answer(event, read, hold) {
  accept(event, (respond) => {
    const release = hold();
    const dispose = createRoot((dispose) => {
      createEffect(() => respond(read()));
      return dispose;
    });
    return () => {
      dispose();
      release();
    };
  });
}

// however many providers a page has, the sounds play once
let chiming = null;
let chimers = 0;
function holdChimes() {
  if (chimers++ === 0) chiming = chimes();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (--chimers === 0) {
      chiming();
      chiming = null;
    }
  };
}

export function CallProvider(element) {
  // what each doc mounted inside holds: by room id, a release each time
  const mounts = new Map();

  function hold(url) {
    const id = roomUrl(url);
    if (!id) return;
    if (!mounts.has(id)) mounts.set(id, []);
    mounts.get(id).push(hearRoom(id, { onScreen: true }));
  }

  function onMounted(event) {
    if ("url" in (event.detail ?? {})) hold(event.detail.url);
  }

  function onUnmounted(event) {
    const id = "url" in (event.detail ?? {}) ? roomUrl(event.detail.url) : null;
    const held = id && mounts.get(id);
    if (!held) return;
    held.pop()();
    if (!held.length) mounts.delete(id);
  }

  function onSubscribe(event) {
    const selector = event.detail?.selector ?? {};
    switch (selector.type) {
      case CALL:
        return answer(event, () => roomState(selector.url), () => hearRoom(selector.url));
      case CALL_ROOM:
        return answer(
          event,
          () => roomState(selector.url),
          () => hearRoom(selector.url, { onScreen: true, name: selector.name }),
        );
      case CALL_NOW:
        // (it holds nothing: the room your call's in is heard already)
        return answer(event, () => ({ room: call.get()?.room ?? null }), () => () => {});
      case CALL_VIDEO:
        return answer(
          event,
          () => ({ wanted: call.videoWanted() }),
          () => holdVideoSpot({ showing: !!selector.showing }),
        );
      case CALL_CONTROLS:
        return answer(event, () => call.controls(), () => () => {});
      case CALL_MEDIA: {
        const onMedia = selector.onMedia;
        if (typeof onMedia !== "function") return;
        // (the media's handed over as it changes, directly: the answer's
        // only that it's being)
        return answer(
          event,
          () => ({ listening: true }),
          () =>
            createRoot((dispose) => {
              createEffect(() => {
                const media = call.media();
                try {
                  onMedia(media);
                } catch (error) {
                  console.warn("[call] call-media's listener threw", error);
                }
              });
              return dispose;
            }),
        );
      }
      case CALL_MIC:
        if (typeof selector.process !== "function") return;
        return answer(event, () => ({ processing: true }), () => onMic(selector.process));
    }
  }

  // one of what's chosen, set (an event: {action: "set", key, value})
  const SETTERS = {
    send: (value) => setQuality("send", value),
    receive: (value) => setQuality("receive", value),
    prefer: setPrefer,
    noise: setNoise,
    faces: setFaces,
    mic: (value) => setDevice("audio", value),
    camera: (value) => setDevice("video", value),
  };

  function onCall(event) {
    const { action, url, at, key, value, id, on } = event.detail ?? {};
    if (action === "ask") ask(url, { at: at ?? null });
    else if (action === "hang-up") hangUp();
    else if (action === "set") SETTERS[key]?.(value);
    else if (action === "hint") setHint(value ?? null);
    else if (action === "sharp") toggleSharp(id);
    else if (action === "mic") setMic(!!on);
    else if (action === "camera") setCamera(!!on);
    else if (action === "screen") (on ? startScreen : stopScreen)();
  }

  // what floats: the question, faces, and whoever's on the stage, in a layer
  // of their own (each its own popover, over the frame)
  const layer = document.createElement("div");
  layer.className = "patchwork-call";
  element.append(layer);
  // the sounds of people coming and going (one frame, one set of them)
  const stopChimes = holdChimes();
  const unrender = render(() => {
    // passed as it is: html calls it for the prop (a getter). wrapped in
    // another function, the prop would be this, not the box
    const area = stageArea(element, () => !!call.get());
    return html`<${CallQuestion} /><${CallFloating} area=${area} /><${CallStage} area=${area} />`;
  }, layer);

  element.addEventListener("patchwork:mounted", onMounted);
  element.addEventListener("patchwork:unmounted", onUnmounted);
  element.addEventListener("patchwork:subscribe", onSubscribe);
  element.addEventListener(CALL_EVENT, onCall);
  // what was mounted before this was (it was loaded late, or swapped in
  // anew): on screen already, and unmounted like the rest later
  for (const view of element.querySelectorAll("patchwork-view[doc-url]")) hold(view.getAttribute("doc-url"));

  return () => {
    element.removeEventListener("patchwork:mounted", onMounted);
    element.removeEventListener("patchwork:unmounted", onUnmounted);
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    element.removeEventListener(CALL_EVENT, onCall);
    for (const held of mounts.values()) for (const release of held) release();
    mounts.clear();
    unrender();
    stopChimes();
    layer.remove();
  };
}
