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

// how much video's sent, or wanted from everyone else, chosen in the menu:
// less, for a bad network or a low battery (from ../experiments/call). each
// an encoding, as videoFor's, or null for as it comes
export const QUALITY = [
  ["full", "full", null],
  ["medium", "medium", { maxBitrate: 500_000, scaleResolutionDownBy: 1.5, maxFramerate: 15 }],
  ["low", "low", { maxBitrate: 250_000, scaleResolutionDownBy: 2, maxFramerate: 10 }],
  ["potato", "potato", { maxBitrate: 100_000, scaleResolutionDownBy: 4, maxFramerate: 5 }],
];
export const isQuality = (id) => QUALITY.some(([known]) => known === id);
/** the encoding for a quality's id (null: full, or one not known) */
export const qualityOf = (id) => QUALITY.find(([known]) => known === id)?.[2] ?? null;

/**
 * the least of `encodings` (each one, or null for as it comes): the lowest
 * bitrate and frame rate, the most scaled down. null if they're all null
 */
export function least(...encodings) {
  const some = encodings.filter(Boolean);
  if (!some.length) return null;
  const all = (key, pick) => {
    const values = some.map((encoding) => encoding[key]).filter((value) => value != null);
    return values.length ? pick(...values) : undefined;
  };
  const out = {
    maxBitrate: all("maxBitrate", Math.min),
    scaleResolutionDownBy: all("scaleResolutionDownBy", Math.max),
    maxFramerate: all("maxFramerate", Math.min),
  };
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out;
}

// ── how big someone's shown ──────────────────────────────────────────────
//
// everyone tells each of the others, between just the two of them (call.js:
// tell), how much of them they're showing (seen.js): not at all, or how tall,
// as it is, up to a little smaller than a floating face starts (ui.js: 150px
// tall). past that it's all one: nobody can tell they're big on your
// screen, only that you've made them small, or that you're not looking

/** as tall as it's told (css px): past this, they're shown, that's all */
export const SEEN_MAX = 120;

/**
 * how much of someone `px` (css px tall, at their biggest) is, as it's told:
 * 0 for not shown at all, how tall in device px (at `dpr`; to 4 css px, so a
 * face being sized isn't told every pixel), or null: shown (as it comes)
 */
export function seenStep(px, dpr = 1) {
  if (!(px > 0)) return 0;
  if (px > SEEN_MAX) return null;
  return Math.round(Math.ceil(px / 4) * 4 * Math.max(1, dpr));
}

/**
 * what to ask someone for: `wants` (sizes.js QUALITY's id) and `seen`
 * (seenStep's), from how much video you want from everyone (`receive`),
 * whether you want theirs in full (`sharpened`: alt clicked) or anyone's
 * (`anySharp`), and how much of them you're showing (`seen`). theirs in full
 * is full whatever its size, while you're looking; while anyone's is, everyone
 * else's is as you've chosen, or low, if that's full
 */
export function askFor({ receive = "full", sharpened = false, anySharp = false, seen = null }) {
  return {
    wants: sharpened ? "full" : anySharp && receive === "full" ? "low" : receive,
    seen: seen === 0 ? 0 : sharpened ? null : (seen ?? null),
  };
}

// what's sent someone who isn't looking (their tab's hidden, or you're
// nowhere on it): a frame a second, tiny, so their faces of you aren't
// empty when they're back, and sharpen from there
const UNSEEN = { maxFramerate: 1, maxBitrate: 30_000 };

/**
 * a video sender's encoding for someone showing it `seen` tall (seenStep's:
 * 0, a step, or null), from a camera `height` px tall. null: as it comes
 */
export function videoForSeen(seen, height = 720) {
  if (seen == null || !(height > 0)) return null;
  const tall = seen === 0 ? 90 : seen;
  const out = seen === 0 ? { ...UNSEEN } : {};
  const scale = Math.round(Math.max(1, height / tall) * 100) / 100;
  if (scale > 1) out.scaleResolutionDownBy = scale;
  // smaller, but every frame: a face is its mouth moving
  if (seen > 0) {
    if (seen <= 120) out.maxBitrate = 100_000;
    else if (seen <= 240) out.maxBitrate = 200_000;
    else out.maxBitrate = 350_000;
  }
  return Object.keys(out).length ? out : null;
}

// ── what's sent each of them, and what's captured ──────────────────────

/**
 * what's sent one person (an encoding, or null for as it comes): no more
 * than you'll send (`send`: QUALITY's id), than a call of `count` takes, than
 * they want (`wants`), than they're showing you (`seen`: seenStep's). as
 * sizes, they're of the camera as it was opened (`native` px tall); what's
 * sent is scaled down from what's `captured` now, which may be less already
 */
export function sendFor({ native = 720, captured = native, count = 1, send = "full", wants = "full", seen = null }) {
  const caps = least(videoFor(count), qualityOf(send), qualityOf(wants), videoForSeen(seen, native));
  if (!caps) return captured > native ? { scaleResolutionDownBy: captured / native } : null;
  const target = native / (caps.scaleResolutionDownBy ?? 1);
  const scale = Math.round(Math.max(1, captured / target) * 100) / 100;
  const out = { ...caps };
  delete out.scaleResolutionDownBy;
  if (scale > 1) out.scaleResolutionDownBy = scale;
  return Object.keys(out).length ? out : null;
}

// never captured smaller than this (px tall): your own face, and where it is
// in the picture (face.js), still want to be seen
export const CAPTURE_LEAST = 180;
// each step the computer's struggling (call.js: strain) takes this much off
export const STRAIN_STEP = 1.5;
export const STRAIN_MOST = 2;

/**
 * what your camera captures ({height, frameRate}, or null: as it was
 * opened, `native`: {height, frameRate}): as much as the one who wants
 * most of it (`peers`: [{wants, seen}]), but no more than you'll send
 * (`send`), than a call of `count` takes, than the computer can manage
 * (`strain` steps)
 */
export function captureFor({ native, count = 1, send = "full", strain = 0, peers = [] }) {
  const tall = native?.height;
  if (!(tall > 0)) return null;
  const own = least(videoFor(count), qualityOf(send), strain > 0 ? { scaleResolutionDownBy: STRAIN_STEP ** strain } : null);
  const mine = tall / (own?.scaleResolutionDownBy ?? 1);
  const need = ({ wants, seen }) => {
    if (seen === 0) return 0;
    const theirs = least(qualityOf(wants), videoForSeen(seen, tall));
    return tall / (theirs?.scaleResolutionDownBy ?? 1);
  };
  const needed = peers.length ? Math.max(...peers.map(need)) : tall;
  const height = Math.round(Math.min(tall, mine, Math.max(needed, CAPTURE_LEAST)));
  const frameRate = own?.maxFramerate;
  if (height >= tall && !frameRate) return null;
  return frameRate ? { height, frameRate } : { height };
}

// what gives when it's struggling (chosen in the menu): each, its label,
// the camera's contentHint, and the sender's degradationPreference
export const PREFER = [
  ["balanced", "balanced", "", "balanced"],
  ["motion", "smooth", "motion", "maintain-framerate"],
  ["detail", "sharp", "detail", "maintain-resolution"],
];
export const isPrefer = (id) => PREFER.some(([known]) => known === id);
// a contentHint (for a moment: call.js setHint), as it's degraded
export const HINTS = ["motion", "detail", "text"];
export const degradeFor = (hint) => (hint === "motion" ? "maintain-framerate" : hint ? "maintain-resolution" : "balanced");

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
