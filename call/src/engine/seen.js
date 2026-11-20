// how big everyone else's faces are on this page (sizes.js: seenStep), and
// when that's worth saying: each of them sends you no more than you show

/**
 * each face on the page but yours (`.patchwork-call-face[data-call-id]`):
 * its id's biggest height on screen, in css px. one that's there but
 * hidden (a floating face behind the one filling the panes) is 0. `roots`:
 * where to look, one or a list (the page, and the picture in picture)
 */
export function measureFaces(roots = document) {
  const out = {};
  const faces = [roots].flat().flatMap((root) => [...root.querySelectorAll(".patchwork-call-face[data-call-id]")]);
  for (const face of faces) {
    const id = face.dataset.callId;
    if (!id || id === "me") continue;
    const shown = face.checkVisibility
      ? face.checkVisibility({ visibilityProperty: true })
      : face.offsetParent !== null;
    const px = shown ? face.getBoundingClientRect().height : 0;
    out[id] = Math.max(out[id] ?? 0, px);
  }
  return out;
}

// a step (seenStep's: 0, a number, or null for past them all) bigger than
// another (undefined: never said, so as it comes)
function bigger(was, now) {
  if (was === undefined || was === null) return false;
  return now === null || now > was;
}

const same = (a, b) => {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
};

/**
 * whether to say `now` (each id's step), having said `said`, and found
 * `before` the last time it looked: at once if anyone's bigger than was
 * said (they're to sharpen), else once it's the same twice running (it's
 * settled: a face being sized, or put away, isn't said all the way)
 */
export function worthSaying(said, now, before) {
  if (same(said, now)) return false;
  if (Object.keys(now).some((id) => bigger(said[id], now[id]))) return true;
  return same(now, before);
}
