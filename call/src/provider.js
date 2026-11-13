// the call provider: put round a frame (threepane mounts it round everything)
// it hears every doc mounted inside it, answers the protocol (protocol.js),
// and draws what floats
import { createEffect, createRoot } from "solid-js";
import { accept } from "@inkandswitch/patchwork-providers";
import { ask, call, hangUp, hearRoom, holdVideoSpot } from "./engine/call.js";
import { roomUrl } from "./engine/room.js";
import { CALL, CALL_EVENT, CALL_ROOM, CALL_VIDEO, roomState } from "./protocol.js";

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

export function CallProvider(element) {
  // what each doc mounted inside holds: by room id, a release each time
  const mounts = new Map();

  function onMounted(event) {
    const id = "url" in (event.detail ?? {}) ? roomUrl(event.detail.url) : null;
    if (!id) return;
    if (!mounts.has(id)) mounts.set(id, []);
    mounts.get(id).push(hearRoom(id, { onScreen: true }));
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
      case CALL_VIDEO:
        return answer(event, () => ({ wanted: call.videoWanted() }), holdVideoSpot);
    }
  }

  function onCall(event) {
    const { action, url, at } = event.detail ?? {};
    if (action === "ask") ask(url, { at: at ?? null });
    else if (action === "hang-up") hangUp();
  }

  element.addEventListener("patchwork:mounted", onMounted);
  element.addEventListener("patchwork:unmounted", onUnmounted);
  element.addEventListener("patchwork:subscribe", onSubscribe);
  element.addEventListener(CALL_EVENT, onCall);

  return () => {
    element.removeEventListener("patchwork:mounted", onMounted);
    element.removeEventListener("patchwork:unmounted", onUnmounted);
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    element.removeEventListener(CALL_EVENT, onCall);
    for (const held of mounts.values()) for (const release of held) release();
    mounts.clear();
  };
}
