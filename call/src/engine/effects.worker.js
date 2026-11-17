// where your camera's pictures are drawn on, for the effect that's on
// (effects.js). a classic worker, not a module one: mediapipe loads its wasm
// with importScripts, which a module worker won't do. an effect's module is
// import()ed here, by the url it's given, and its draw(ctx, frame) is called
// for each picture (see docs/superpowers/specs/2026-11-17-call-effects-design.md)
import { follow } from "./smooth.js";

const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
// a look for landmarks at most this often (ms), and the pictures between
// are drawn on with the last
const EVERY = 50;
// a draw that throws this many pictures running is given up on
const BAD = 10;
// pictures taking longer than this (ms) to make, on average, for this many
// running: it's too much for this computer
const SLOW = 90;
const SLOW_FOR = 40;

let effect = null; // {id, needs, mod, bad}
let wanted = 0; // which choice of effect is the latest, for one that's slow to import
let landmarker = null;
let started = null; // the model's being loaded
let seen = { landmarks: null, missed: 0 };
let lastLook = 0;
let slow = 0;
let canvas = null;
let ctx = null;

const say = (message) => postMessage(message);
const problem = (text, drop = true) => say({ type: "problem", text, drop });

async function useEffect({ id, url, needs }) {
  const mine = ++wanted;
  try {
    effect?.mod?.dispose?.();
  } catch {}
  effect = null;
  if (!url) return;
  try {
    const mod = await import(url);
    if (typeof mod.draw !== "function") throw new Error("it has no draw()");
    if (mine !== wanted) return;
    effect = { id, needs: needs ?? [], mod, bad: 0 };
    if (effect.needs.includes("landmarks")) say({ type: "wants", what: "landmarks" });
  } catch (error) {
    if (mine === wanted) problem(`couldn't load the ${id} effect: ${error?.message ?? error}`);
  }
}

async function useModel(bytes) {
  if (landmarker || started) return;
  started = (async () => {
    const vision = await import(`${MEDIAPIPE}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
    landmarker = await vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: new Uint8Array(bytes) },
      runningMode: "VIDEO",
      numFaces: 1,
    });
    say({ type: "ready", what: "landmarks" });
  })().catch((error) => {
    started = null;
    problem(`couldn't start the face finder: ${error?.message ?? error}`, false);
  });
}

function look(now) {
  if (!landmarker || now - lastLook < EVERY) return;
  lastLook = now;
  try {
    const found = landmarker.detectForVideo(canvas, now);
    seen = follow(seen, found.faceLandmarks[0] ?? null);
  } catch (error) {
    console.warn("[call] couldn't look for a face", error);
  }
}

function transform(frame, controller) {
  const began = performance.now();
  const current = effect;
  if (!current) {
    // nothing to draw: the picture goes as it is
    controller.enqueue(frame);
    return;
  }
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext("2d");
  }
  ctx.drawImage(frame, 0, 0, width, height);
  if (current.needs.includes("landmarks")) look(began);
  try {
    current.mod.draw(ctx, {
      landmarks: current.needs.includes("landmarks") ? seen.landmarks : null,
      mask: null,
      time: began,
      width,
      height,
    });
    current.bad = 0;
  } catch (error) {
    console.warn(`[call] the ${current.id} effect threw`, error);
    if (++current.bad >= BAD && effect === current) {
      effect = null;
      problem(`the ${current.id} effect keeps failing: it's off`);
    }
  }
  const out = new VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration ?? undefined });
  frame.close();
  controller.enqueue(out);
  slow = performance.now() - began > SLOW ? slow + 1 : 0;
  if (slow === SLOW_FOR) say({ type: "slow" });
}

function start({ readable, writable }) {
  readable
    .pipeThrough(new TransformStream({ transform }))
    .pipeTo(writable)
    .catch((error) => problem(`the video effects stopped: ${error?.message ?? error}`));
}

onmessage = ({ data }) => {
  if (data.type === "start") start(data);
  else if (data.type === "effect") useEffect(data);
  else if (data.type === "model") useModel(data.bytes);
};
