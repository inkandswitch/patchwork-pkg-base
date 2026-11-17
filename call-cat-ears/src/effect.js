// cat ears: what the call's worker draws, for each picture of your camera. it
// has to carry all it uses (a worker has no import map), so it imports only
// ears.js, which is bundled into it
import { place } from "./ears.js";

const FUR = "#3a3541";
const FUR_EDGE = "#241f2a";
const INSIDE = "#f3a9bd";
const NOSE = "#f0839f";

function triangle(ctx, [a, b], tip) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(b.x, b.y);
  ctx.closePath();
}

/**
 * draw cat ears and whiskers on the picture `ctx` has, where the face in
 * `frame.landmarks` is: nothing, where there isn't one
 */
export function draw(ctx, frame) {
  const found = place(frame.landmarks, frame.width, frame.height, frame.time);
  if (!found) return;
  const { size } = found;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // behind: ears
  for (const ear of found.ears) {
    triangle(ctx, ear.base, ear.tip);
    ctx.fillStyle = FUR;
    ctx.fill();
    ctx.strokeStyle = FUR_EDGE;
    ctx.lineWidth = size * 0.025;
    ctx.stroke();
    triangle(ctx, ear.inner.base, ear.inner.tip);
    ctx.fillStyle = INSIDE;
    ctx.fill();
  }

  // a nose's tint
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = NOSE;
  ctx.beginPath();
  ctx.ellipse(found.nose.x, found.nose.y, found.nose.radius, found.nose.radius * 0.75, found.roll, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // whiskers: a dark line under a light one, to be seen on anything
  for (const [style, width] of [
    ["rgba(30, 25, 35, 0.55)", size * 0.016],
    ["rgba(255, 255, 255, 0.95)", size * 0.008],
  ]) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const { from, to } of found.whiskers) {
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
