// video effects, which any package can contribute as a "patchwork:call-effect"
// plugin: each says what it is and what it needs, and gives a module with a
// draw(ctx, frame). your camera's pictures go through a worker that draws the
// one that's on, and the track that comes out goes to the call in place of the
// camera's, so everyone sees it. all of it's in the design doc,
// docs/superpowers/specs/2026-11-17-call-effects-design.md
import { loadModel } from "./landmarks.js";

export const EFFECT = "patchwork:call-effect";
export const KINDS = ["overlay", "background", "filter"];
const NEEDS = ["landmarks", "mask"];

/**
 * whether this browser can do it: it needs a processor and a generator of
 * video tracks, and a canvas a worker can draw on. chrome has them, firefox
 * and safari don't, and there effects aren't offered (the design doc says why)
 */
export const supported = () =>
  typeof globalThis.MediaStreamTrackProcessor === "function" &&
  typeof globalThis.MediaStreamTrackGenerator === "function" &&
  typeof globalThis.OffscreenCanvas === "function" &&
  typeof globalThis.Worker === "function";

/**
 * an effect, from its plugin: {id, name, icon, kind, needs, url} (url's where
 * the worker gets its module), or null if it isn't one that can be used
 */
export function described(plugin) {
  if (!plugin || typeof plugin.id !== "string" || typeof plugin.effect !== "string") return null;
  let url;
  try {
    url = new URL(plugin.effect, plugin.importUrl).href;
  } catch {
    return null;
  }
  return {
    id: plugin.id,
    name: typeof plugin.name === "string" ? plugin.name : plugin.id,
    icon: typeof plugin.icon === "string" ? plugin.icon : "",
    kind: KINDS.includes(plugin.kind) ? plugin.kind : "overlay",
    needs: Array.isArray(plugin.needs) ? plugin.needs.filter((need) => NEEDS.includes(need)) : [],
    url,
  };
}

async function registry() {
  const { getRegistry } = await import("@inkandswitch/patchwork-plugins");
  return getRegistry(EFFECT);
}

/** the effects there are now: [{id, name, icon, kind, needs, url}] */
export async function list() {
  return (await registry()).all().map(described).filter(Boolean);
}

/** the effect `id`, or null if there's none (a package that's gone, say) */
export async function find(id) {
  return described((await registry()).get(id));
}

/**
 * `onChange` hears the effects there are, now and whenever they change (a
 * package loaded or unloaded). returns a way to stop
 */
export function watch(onChange) {
  let stopped = false;
  let off = null;
  registry().then(
    (found) => {
      if (stopped) return;
      const tell = () => onChange(found.all().map(described).filter(Boolean));
      tell();
      off = found.on("changed", tell);
    },
    () => {},
  );
  return () => {
    stopped = true;
    if (typeof off === "function") off();
  };
}

/**
 * `raw` (a camera track) with `effect` drawn on its pictures: a new track,
 * with `source`, the camera's, `setEffect(effect | null)`, to draw another
 * on it, and a stop() that lets go of the camera and the worker too.
 * `onProblem(text, {drop})` hears what goes wrong; `drop` says the effect's
 * to go (the camera as it is). throws if it can't be started
 */
export function processed(raw, effect, { onProblem = () => {} } = {}) {
  const worker = new Worker(new URL("./effects.worker.js", import.meta.url));
  let track;
  try {
    const processor = new MediaStreamTrackProcessor({ track: raw });
    const generator = new MediaStreamTrackGenerator({ kind: "video" });
    worker.postMessage({ type: "start", readable: processor.readable, writable: generator.writable }, [
      processor.readable,
      generator.writable,
    ]);
    track = generator;
  } catch (error) {
    worker.terminate();
    throw error;
  }

  let stopped = false;
  let sentModel = false;

  async function sendModel() {
    if (sentModel) return;
    sentModel = true;
    try {
      const bytes = await loadModel();
      if (!stopped) worker.postMessage({ type: "model", bytes });
    } catch (error) {
      // it's drawn without landmarks, then (ears draw nothing). a later
      // try (another effect that needs them) asks again
      sentModel = false;
      onProblem(`couldn't get the face model: ${error?.message ?? error}`, { drop: false });
    }
  }

  worker.onmessage = ({ data }) => {
    if (stopped) return;
    if (data?.type === "wants" && data.what === "landmarks") sendModel();
    else if (data?.type === "problem") onProblem(String(data.text), { drop: data.drop !== false });
    else if (data?.type === "slow") onProblem("video effects are too much for this computer: they're off", { drop: true });
  };
  worker.onerror = (event) => onProblem(`video effects couldn't start: ${event.message ?? "an error"}`, { drop: true });

  track.source = raw;
  track.setEffect = (next) => {
    worker.postMessage(
      next ? { type: "effect", id: next.id, url: next.url, needs: next.needs } : { type: "effect", id: null, url: null },
    );
  };
  const stop = track.stop.bind(track);
  track.stop = () => {
    if (stopped) return;
    stopped = true;
    stop();
    worker.terminate();
    raw.stop();
  };
  track.setEffect(effect);
  return track;
}
