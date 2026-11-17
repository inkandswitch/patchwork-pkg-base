// where cat ears, whiskers and a nose go on a face, from its landmarks
// (mediapipe's face mesh: 478 points, x and y as fractions of the picture).
// all of it's pure: points in, shapes out, so it's the part that's tested

// the points it goes by
const EYE = { left: 33, right: 263 }; // outer corners, as they are in the picture
const FACE = { left: 234, right: 454 }; // the face's edges, at the cheekbones
const BROW = { left: [54, 103], right: [284, 332] }; // along the top of the forehead
const CHEEK = { left: 205, right: 425 };
const NOSE = 1;

const px = (point, width, height) => ({ x: point.x * width, y: point.y * height });
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const along = (from, direction, by) => ({ x: from.x + direction.x * by, y: from.y + direction.y * by });
const turned = (direction, by) => ({
  x: direction.x * Math.cos(by) - direction.y * Math.sin(by),
  y: direction.x * Math.sin(by) + direction.y * Math.cos(by),
});

/**
 * a little twitch, now and again (ms): an angle to turn an ear by (radians).
 * the sides take it in turns
 */
export function twitch(time, side) {
  const every = side < 0 ? 5200 : 7300;
  const at = (time % every) / 250;
  return at < 1 ? Math.sin(at * Math.PI) * 0.12 * -side : 0;
}

/**
 * `landmarks` ({x, y} per point, or null) on a picture `width` by `height`:
 * {roll, size, ears: [{base: [a, b], tip, inner: {base: [a, b], tip}}], whiskers: [{from, to}], nose: {x, y, radius}},
 * all in pixels, or null where there's no face to speak of. the ears follow the
 * roll of the head (the slope of the line between the eyes) and are as big as
 * the face is wide. `time` makes them twitch
 */
export function place(landmarks, width, height, time = 0) {
  if (!landmarks || landmarks.length < 468 || !width || !height) return null;
  const at = (n) => px(landmarks[n], width, height);
  const eyes = { x: at(EYE.right).x - at(EYE.left).x, y: at(EYE.right).y - at(EYE.left).y };
  const roll = Math.atan2(eyes.y, eyes.x);
  const across = { x: Math.cos(roll), y: Math.sin(roll) };
  // up, as the head has it (so over a tilted head it tilts)
  const up = { x: Math.sin(roll), y: -Math.cos(roll) };
  const size = Math.hypot(at(FACE.right).x - at(FACE.left).x, at(FACE.right).y - at(FACE.left).y);
  if (!(size > 0)) return null;

  const ears = [-1, 1].map((side) => {
    const [a, b] = side < 0 ? BROW.left : BROW.right;
    // sunk a little into the head, so nothing shows between it and the ear
    const root = along(mid(at(a), at(b)), up, -0.07 * size);
    const lean = turned(up, side * 0.14 + twitch(time, side));
    const halfBase = 0.18 * size;
    const base = [along(root, across, -halfBase), along(root, across, halfBase)];
    const tip = along(root, lean, 0.5 * size);
    const innerRoot = along(root, lean, 0.04 * size);
    const inner = {
      base: [along(innerRoot, across, -halfBase * 0.55), along(innerRoot, across, halfBase * 0.55)],
      tip: along(root, lean, 0.38 * size),
    };
    return { base, tip, inner };
  });

  const whiskers = [];
  for (const side of [-1, 1]) {
    const cheek = at(side < 0 ? CHEEK.left : CHEEK.right);
    for (const spread of [-0.3, 0, 0.3]) {
      // out from the face along the eye line, fanned, and drooping a touch
      const out = turned({ x: across.x * side, y: across.y * side }, spread * side + 0.08 * side);
      const from = along(cheek, out, -0.02 * size);
      whiskers.push({ from, to: along(from, out, 0.5 * size) });
    }
  }

  return { roll, size, ears, whiskers, nose: { ...at(NOSE), radius: 0.05 * size } };
}
