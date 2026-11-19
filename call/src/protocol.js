// how anything outside the call's own parts talks to it: through the
// provider, by events and subscriptions (patchwork-providers), in plain
// data, so it works from anywhere a frame puts it
//
//   patchwork:call (an event)        {action: "ask", url, at?} | {action: "hang-up"}
//                                    | {action: "set", key, value}: one of
//                                      what call-controls says is chosen:
//                                      send, receive (sizes.js QUALITY),
//                                      prefer (PREFER), noise, faces, mic,
//                                      camera (a device id)
//                                    | {action: "hint", value}: your camera's
//                                      contentHint for now ("motion",
//                                      "detail", "text"), or null: as chosen
//                                    | {action: "sharp", id}: their video in
//                                      full, just for you, or not again
//                                    | {action: "mic" | "camera" | "screen", on}
//   patchwork:call {url}             → {here, others, elsewhere}
//   patchwork:call-room {url, name}  this room is where you are, called name
//                                    → {here, others, elsewhere}
//   patchwork:call-video {showing}   this frame can show the video, and
//                                    whether it is now → {wanted}
//   patchwork:call-now               which room your call's in → {room}: its
//                                    url, or null. it hears no room, so ask
//                                    it as often as you like (a list of docs,
//                                    a row each)
//   patchwork:call-controls          → call.controls(): everything chosen,
//                                    and what's done about it, as plain data
//                                    (engine/call.js)
//
// and live media, for what's in the same window (a track can't be sent
// down a port): a function in the selector, called with it directly
//
//   patchwork:call-media {onMedia}   onMedia(call.media()) now and as it
//                                    changes: your mic as it's sent, your
//                                    camera and screen, everyone's streams
//                                    (null out of a call) → {listening}
//   patchwork:call-mic {process}     process(track) → a track, or {track,
//                                    stop}, or a promise of either: your mic
//                                    goes through it before it's sent, while
//                                    subscribed (onMic) → {processing}
//
// a url is any room id (room.js): a doc's url, or "key:<hex>"
import { call, onCallIn } from "./engine/call.js";
import { roomUrl } from "./engine/room.js";

export { CALL, CALL_CONTROLS, CALL_EVENT, CALL_MEDIA, CALL_MIC, CALL_NOW, CALL_ROOM, CALL_VIDEO } from "./protocol-names.js";

/** {here, others, elsewhere} for the room `url`: you're in its call; how many others are; you're in one somewhere else */
export function roomState(url) {
  const id = roomUrl(url);
  const now = call.get()?.room ?? null;
  const here = !!id && now === id;
  return { here, others: id ? onCallIn(id).length : 0, elsewhere: !!now && !here };
}
