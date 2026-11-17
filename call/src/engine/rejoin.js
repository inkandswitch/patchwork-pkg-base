// the call you're in, kept in the tab (kept.js), so a reload puts you back
// in it. it's kept while you're in it, and when the page goes it's stamped
// with when: a page that comes back soon after, to the same room, joins
// again, with your camera and mic as they were. hanging up forgets it, and
// so does too long (reopening a closed tab tomorrow isn't arriving back)
import { keep, kept } from "./kept.js";

export const REJOIN_KEY = "patchwork-call:rejoin";
export const REJOIN_WITHIN = 2 * 60_000;

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

/** you're in the call in `room`, with your camera and mic so */
export function keepCall({ room, camera, mic }, { storage } = {}) {
  keep(REJOIN_KEY, { room: String(room), camera: !!camera, mic: !!mic, at: null }, storage);
}

/** the page is going (a reload, say), while you're in it */
export function leavingCall({ at = Date.now(), storage } = {}) {
  const call = kept(REJOIN_KEY, null, storage);
  if (isObject(call)) keep(REJOIN_KEY, { ...call, at }, storage);
}

/** you've hung up */
export function forgetCall({ storage } = {}) {
  keep(REJOIN_KEY, null, storage);
}

/** the call in `room` to join again ({camera, mic}), if there's one */
export function callToRejoin(room, { now = Date.now(), storage } = {}) {
  const call = kept(REJOIN_KEY, null, storage);
  if (!isObject(call) || call.room !== room || typeof call.at !== "number") return null;
  const ago = now - call.at;
  if (ago < 0 || ago > REJOIN_WITHIN) return null;
  return { camera: !!call.camera, mic: !!call.mic };
}
