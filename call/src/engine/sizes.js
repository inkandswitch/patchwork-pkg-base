// how a call's shown, and sent, for how many are in it. nothing imported:
// node's tests read it too
//
// everyone in a call connects to everyone else (call.js), so each camera's
// sent once for each of the others: twenty people is nineteen copies out of
// every browser. past a handful it's sent smaller, slower and fewer frames a
// second, so it still goes. (any more than that wants a server in the middle,
// which this isn't)

/** the sidebar's faces, for `count` people (you too): "tiles", "grid" or "chips" */
export function tilesFor(count) {
  if (count <= 4) return "tiles";
  if (count <= 9) return "grid";
  return "chips";
}

/**
 * a video sender's encoding for a call of `count` people (you too), or null
 * for as it comes
 */
export function videoFor(count) {
  if (count <= 5) return null;
  if (count <= 9) return { maxBitrate: 300_000, scaleResolutionDownBy: 2, maxFramerate: 20 };
  return { maxBitrate: 120_000, scaleResolutionDownBy: 4, maxFramerate: 12 };
}

// ── who's speaking ────────────────────────────────────────────────────────

// how loud's speaking (0 to 1, the sound's root mean square)
export const SPEAKING_LEVEL = 0.04;
// it's speaking once it's been that loud this long (not a click or a cough)
export const SPEAKING_AFTER = 150;
// and stops once it's been quiet this long (not a breath between words)
export const QUIET_AFTER = 700;

/** how loud `samples` are (a byte time-domain buffer, 128 is silence) */
export function levelOf(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) {
    const x = (sample - 128) / 128;
    sum += x * x;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * speaking or not, after hearing `level` at `now`, from `state`
 * ({speaking, loudSince, quietSince})
 */
export function speakingStep(state, level, now) {
  if (level >= SPEAKING_LEVEL) {
    const loudSince = state.loudSince ?? now;
    return { speaking: state.speaking || now - loudSince >= SPEAKING_AFTER, loudSince, quietSince: null };
  }
  const quietSince = state.quietSince ?? now;
  return { speaking: state.speaking && now - quietSince < QUIET_AFTER, loudSince: null, quietSince };
}
