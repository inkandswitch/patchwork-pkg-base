// the wiggle round a floating face while they're speaking: their sound's
// waveform, all the way round, as an oscilloscope draws it. half of it up
// the left from the bottom, and the same again up the right, so the two ends
// meet. made as loud as the loudest they've been lately, so talking quietly
// shows as much as shouting. nothing imported: node's tests read it too

/**
 * `count` points round the ring of `samples` (a float time-domain buffer,
 * -1 to 1): `span` of them, from the first time they go up through silence
 * (so it holds still, rather than running round), each point the middle of
 * its stretch. point 0 is the bottom middle, and they go round
 */
export function ringWave(samples, count, span) {
  span = Math.min(span, samples.length);
  let from = 0;
  for (let i = 1; i < samples.length - span; i++) {
    if (samples[i - 1] < 0 && samples[i] >= 0) {
      from = i;
      break;
    }
  }
  const half = Math.floor(count / 2);
  const along = new Array(half + 1);
  for (let k = 0; k <= half; k++) {
    const a = from + Math.floor((k * span) / (half + 1));
    const b = Math.max(a + 1, from + Math.floor(((k + 1) * span) / (half + 1)));
    let sum = 0;
    for (let i = a; i < b; i++) sum += samples[i];
    along[k] = sum / (b - a);
  }
  const values = new Array(count);
  for (let i = 0; i < count; i++) values[i] = along[Math.min(i, count - i)];
  return values;
}

// lately: the loudest falls this much each frame (about a second, at 60 a second)
export const LOUDER_FALL = 0.96;
// the quietest that's made as loud as it goes (below that's hum, not them):
// a whisper's peaks, through a call's noise suppression
export const LOUDER_FLOOR = 0.008;
// how loud (the sound's root mean square) there's something to show: a
// whisper, well under what's speaking (sizes.js)
export const WIGGLE_HEARD = 0.004;
// and it's shown this long after (ms), so a whisper's gaps don't flicker it
export const WIGGLE_HOLD = 400;

/**
 * `values` (-1 to 1) made as loud as `loudest` (the loudest lately, from
 * before), and the loudest lately now: {values, loudest}
 */
export function louder(values, loudest = 0) {
  let peak = 0;
  for (const value of values) peak = Math.max(peak, Math.abs(value));
  loudest = Math.max(peak, loudest * LOUDER_FALL);
  const gain = 1 / Math.max(loudest, LOUDER_FLOOR);
  return { values: values.map((value) => Math.max(-1, Math.min(1, value * gain))), loudest };
}

/**
 * the point `along` (0 to 1) the edge of a `w` by `h` box with corners
 * `r` round (centred on 0, y down), from its bottom middle round by the
 * left, and which way's out from there: {x, y, nx, ny}
 */
export function edgeAt(w, h, r, along) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const sx = w / 2 - r;
  const sy = h / 2 - r;
  const arc = (Math.PI * r) / 2;
  // [length, (t from 0 to its length) => point]
  const line = (x0, y0, x1, y1, nx, ny) => [
    Math.hypot(x1 - x0, y1 - y0),
    (t, length) => ({ x: x0 + ((x1 - x0) * t) / (length || 1), y: y0 + ((y1 - y0) * t) / (length || 1), nx, ny }),
  ];
  const corner = (cx, cy, from) => [
    arc,
    (t) => {
      const angle = from + (r ? t / r : 0);
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      return { x: cx + r * nx, y: cy + r * ny, nx, ny };
    },
  ];
  const parts = [
    line(0, h / 2, -sx, h / 2, 0, 1),
    corner(-sx, sy, Math.PI / 2),
    line(-w / 2, sy, -w / 2, -sy, -1, 0),
    corner(-sx, -sy, Math.PI),
    line(-sx, -h / 2, sx, -h / 2, 0, -1),
    corner(sx, -sy, (Math.PI * 3) / 2),
    line(w / 2, -sy, w / 2, sy, 1, 0),
    corner(sx, sy, 0),
    line(sx, h / 2, 0, h / 2, 0, 1),
  ];
  const total = parts.reduce((sum, [length]) => sum + length, 0);
  let left = (((along % 1) + 1) % 1) * total;
  for (const [length, at] of parts) {
    if (left <= length) return at(left, length);
    left -= length;
  }
  return parts.at(-1)[1](parts.at(-1)[0], parts.at(-1)[0]);
}

/**
 * the wiggle's points round a `w` by `h` box with corners `r` round, each
 * `out` from its edge, and its value (-1 to 1) of `swing` either way
 */
export function wiggle(w, h, r, values, out, swing) {
  return values.map((value, i) => {
    const at = edgeAt(w, h, r, i / values.length);
    const away = out + value * swing;
    return [at.x + at.nx * away, at.y + at.ny * away];
  });
}
