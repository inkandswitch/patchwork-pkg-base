// where your face is in your camera's picture, so faces can be shown centred
// on it. it's found in your own camera, four times a second while it's
// on, and goes to everyone else in the call with the rest of what you say
// (call.js), so nobody finds anyone else's.
//
// the browser's own FaceDetector, where there is one (shape detection: only
// behind a flag, mostly); else google's mediapipe face detector, its short
// range model, fetched the first time it's wanted
const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const EVERY = 250;
// how far it has to move (a fraction of the picture) to be said again: a
// face held still holds still
const MOVED = 0.01;
// how much of the way to where it's just been found each look goes: the
// rest's where it was, so a jittery find comes out steady
const EASE = 0.4;

const clamp01 = (n) => Math.max(0, Math.min(1, n));

// {find(video, now)}: the biggest face in `video`, {x, y, width, height} in its
// pixels, or null. null if neither can be had
let detector = null;
function load() {
  detector ??= (async () => {
    if (typeof globalThis.FaceDetector === "function") {
      try {
        const native = new globalThis.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        return {
          async find(video) {
            const [face] = await native.detect(video);
            return face?.boundingBox ?? null;
          },
        };
      } catch {}
    }
    const vision = await import(`${MEDIAPIPE}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
    const found = await vision.FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5,
    });
    return {
      async find(video, now) {
        const boxes = found
          .detectForVideo(video, now)
          .detections.map((detection) => detection.boundingBox)
          .filter(Boolean);
        const biggest = boxes.sort((a, b) => b.width * b.height - a.width * a.height)[0];
        return biggest ? { x: biggest.originX, y: biggest.originY, width: biggest.width, height: biggest.height } : null;
      },
    };
  })().catch((error) => {
    console.warn("[call] can't find faces", error);
    return null;
  });
  return detector;
}

/**
 * find the face in `stream`'s pictures till stopped. `onFace` hears where it
 * is, as fractions of the picture ({x, y}: its middle, and size: its height),
 * when that moves. returns a way to stop
 */
export function watchFace(stream, onFace) {
  let stopped = false;
  let timer = null;
  let said = null;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.play().catch(() => {});

  async function look() {
    timer = null;
    if (stopped) return;
    const found = await load();
    if (!found || stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      try {
        const box = await found.find(video, performance.now());
        if (box && !stopped) {
          const face = {
            x: clamp01((box.x + box.width / 2) / video.videoWidth),
            y: clamp01((box.y + box.height / 2) / video.videoHeight),
            size: clamp01(box.height / video.videoHeight),
          };
          // eased (and everyone's picture glides there: styles.css)
          const toward = (from, to) => from + (to - from) * EASE;
          const next = said
            ? { x: toward(said.x, face.x), y: toward(said.y, face.y), size: toward(said.size, face.size) }
            : face;
          if (!said || Math.abs(next.x - said.x) > MOVED || Math.abs(next.y - said.y) > MOVED) {
            said = next;
            onFace({ x: round(next.x), y: round(next.y), size: round(next.size) });
          }
        }
      } catch {}
    }
    if (!stopped) timer = setTimeout(look, EVERY);
  }
  look();

  return () => {
    stopped = true;
    clearTimeout(timer);
    video.srcObject = null;
  };
}

const round = (n) => Math.round(n * 1000) / 1000;

/** a face from what someone said, or null */
export function faceFrom(value) {
  if (!value || typeof value !== "object") return null;
  const { x, y, size } = value;
  if (![x, y, size].every((n) => typeof n === "number" && n >= 0 && n <= 1)) return null;
  return { x, y, size };
}

/**
 * show `video` (object-fit: cover) in its box with `face` ({x, y}, fractions
 * of the picture) as near its middle as the picture allows
 */
export function centreOn(video, face) {
  const { videoWidth: vw, videoHeight: vh, clientWidth: bw, clientHeight: bh } = video;
  if (!face || !vw || !vh || !bw || !bh) {
    video.style.objectPosition = "";
    return;
  }
  const scale = Math.max(bw / vw, bh / vh);
  const along = (fraction, box, picture) =>
    Math.abs(picture - box) < 0.5 ? 0.5 : clamp01((box / 2 - fraction * picture) / (box - picture));
  video.style.objectPosition = `${along(face.x, bw, vw * scale) * 100}% ${along(face.y, bh, vh * scale) * 100}%`;
}
