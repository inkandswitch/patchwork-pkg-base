// landmarks as they're found jitter a little from one look to the next. each
// look is only part of the way there, so what's drawn from them holds steady

/**
 * `next` (a face's landmarks: [{x, y, z}]) eased `by` of the way from `from`
 * (the last ones, or null). with nothing before, it's `next` as it is
 */
export function ease(from, next, by = 0.5) {
  if (!next) return null;
  if (!from || from.length !== next.length) return next;
  return next.map((point, at) => ({
    x: from[at].x + (point.x - from[at].x) * by,
    y: from[at].y + (point.y - from[at].y) * by,
    z: from[at].z + (point.z - from[at].z) * by,
  }));
}

/**
 * the landmarks to go on with, from a look's `next` (or null: no face
 * found). a face missed once or twice is held where it was, as it's more
 * likely a blink of the detector than someone leaving. returns
 * {landmarks, missed}, to be given back as `state` for the next look
 */
export function follow(state, next, { by = 0.5, hold = 4 } = {}) {
  if (next) return { landmarks: ease(state.landmarks, next, by), missed: 0 };
  const missed = state.missed + 1;
  return { landmarks: missed > hold ? null : state.landmarks, missed };
}
