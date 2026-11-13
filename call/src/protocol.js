// how anything outside the call's own parts talks to it: through the
// provider, by events and subscriptions (patchwork-providers), in plain
// data, so it works from anywhere a frame puts it
//
//   patchwork:call (an event)        {action: "ask", url, at?} | {action: "hang-up"}
//   patchwork:call {url}             → {here, others, elsewhere}
//   patchwork:call-room {url, name}  this room is where you are, called name
//                                    → {here, others, elsewhere}
//   patchwork:call-video             this frame can show the video
//                                    → {wanted}
//
// a url is any room id (room.js): a doc's url, or "key:<hex>"
import { call, onCallIn } from "./engine/call.js";
import { roomUrl } from "./engine/room.js";

export const CALL_EVENT = "patchwork:call";
export const CALL = "patchwork:call";
export const CALL_ROOM = "patchwork:call-room";
export const CALL_VIDEO = "patchwork:call-video";

/** {here, others, elsewhere} for the room `url`: you're in its call; how many others are; you're in one somewhere else */
export function roomState(url) {
  const id = roomUrl(url);
  const now = call.get()?.room ?? null;
  const here = !!id && now === id;
  return { here, others: id ? onCallIn(id).length : 0, elsewhere: !!now && !here };
}
