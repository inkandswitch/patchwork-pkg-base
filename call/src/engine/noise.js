// what's done about the noise round your voice, before it goes to the call:
//   browser        the browser's own noise suppression (webrtc's): good on
//                  a steady hum (a fan), not on keys or a dog
//   deepfilternet  DeepFilterNet3, a small neural net, run here in an
//                  AudioWorklet (../vendor/deepfilternet): takes out typing
//                  and chatter too, and keeps the whole voice. its wasm and
//                  model (23MB) are downloaded the first time it's wanted,
//                  checked, and kept in indexeddb (not the cache storage:
//                  the service worker clears what isn't its own there)
//   none           nothing: the mic as it is (echo cancelling still)
import { createRoot, createSignal } from "solid-js";
import { lasting } from "./lasting.js";
import { createDeepFilterNetAudioWorklet, DEEPFILTERNET_SAMPLE_RATE } from "../vendor/deepfilternet/deepfilternet.js";

export const NOISE = [
  ["browser", "the browser's"],
  ["deepfilternet", "DeepFilterNet"],
  ["none", "none"],
];
export const isNoise = (value) => NOISE.some(([id]) => id === value);

// where the wasm and model come from, pinned, and what they must hash to
// (sha-256, from the npm tarball): anything else is refused
const VERSION = "0.2.0";
const FROM = `https://cdn.jsdelivr.net/npm/@workadventure/noise-suppression@${VERSION}/dist/assets/deepfilternet/`;
const FILES = {
  wasm: {
    name: "df_bg.wasm",
    type: "application/wasm",
    size: 14643565,
    sha256: "8ebf2b217b80fc128505b993c8d7d7d892df5a845ab7a2516fed74b76e7fe708",
  },
  model: {
    name: "DeepFilterNet3_onnx.tar.gz",
    type: "application/gzip",
    size: 7983136,
    sha256: "c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616",
  },
};
export const DOWNLOAD_BYTES = FILES.wasm.size + FILES.model.size;

// ── keeping them: indexeddb, by name at its hash ────────────────────────

const DB = "lattice-wm:deepfilternet";
const STORE = "files";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function kept(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  } catch {
    return null;
  }
}

async function keep(key, blob) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(blob, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    }).finally(() => db.close());
  } catch (error) {
    // not kept (private browsing, say): it's downloaded again next time
    console.warn("[call] couldn't keep DeepFilterNet", error);
  }
}

const keyOf = (file) => `${file.name}@${file.sha256}`;

async function hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// a file, from indexeddb, or downloaded (telling `got` how far it's got)
// and checked and kept
async function file(spec, got) {
  const had = await kept(keyOf(spec));
  if (had) {
    got(spec.size);
    return had;
  }
  const response = await fetch(FROM + spec.name);
  if (!response.ok || !response.body) throw new Error(`couldn't download ${spec.name} (${response.status})`);
  const chunks = [];
  let length = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
    got(length);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  if ((await hex(bytes)) !== spec.sha256) throw new Error(`${spec.name} isn't the one it should be: not using it`);
  const blob = new Blob([bytes], { type: spec.type });
  await keep(keyOf(spec), blob);
  return blob;
}

// ── getting them, once a page ───────────────────────────────────────────

// how it's going, to show: {state: "none" | "loading" | "ready" | "failed",
// got, total, problem}
const status = lasting("patchwork-call:noise:status", () =>
  createRoot(() => createSignal({ state: "none", got: 0, total: DOWNLOAD_BYTES, problem: null })),
);
export const download = status[0];
const setDownload = status[1];

const loading = lasting("patchwork-call:noise:loading", () => ({ promise: null, urls: null }));

/** whether the wasm and model are here already (no download needed) */
export async function haveModel() {
  if (loading.urls) return true;
  return !!(await kept(keyOf(FILES.wasm))) && !!(await kept(keyOf(FILES.model)));
}

// kept from before (another visit): it's here, not a download, to show
haveModel().then((have) => {
  if (have && download().state === "none") {
    setDownload({ state: "ready", got: DOWNLOAD_BYTES, total: DOWNLOAD_BYTES, problem: null });
  }
});

/** the wasm's and model's urls (object urls), downloading them the first time */
export function loadModel() {
  let active = true;
  loading.promise ??= (async () => {
    const got = { wasm: 0, model: 0 };
    const tell = () => {
      if (active) setDownload({ state: "loading", got: got.wasm + got.model, total: DOWNLOAD_BYTES, problem: null });
    };
    tell();
    const [wasm, model] = await Promise.all(
      ["wasm", "model"].map((which) =>
        file(FILES[which], (bytes) => {
          got[which] = bytes;
          tell();
        }),
      ),
    );
    loading.urls = { wasmUrl: URL.createObjectURL(wasm), modelUrl: URL.createObjectURL(model) };
    setDownload({ state: "ready", got: DOWNLOAD_BYTES, total: DOWNLOAD_BYTES, problem: null });
    return loading.urls;
  })().catch((error) => {
    active = false;
    loading.promise = null;
    setDownload({ state: "failed", got: 0, total: DOWNLOAD_BYTES, problem: String(error?.message ?? error) });
    throw error;
  });
  return loading.promise;
}

// ── using it ────────────────────────────────────────────────────────────

/**
 * `raw` (a mic track, taken with the browser's noise suppression off), with
 * DeepFilterNet's taken out of it: a new track. stopping it stops `raw` too,
 * and lets go of everything in between. `onOverload` is told if this
 * computer can't keep up with it
 */
export async function suppressed(raw, { onOverload } = {}) {
  const { wasmUrl, modelUrl } = await loadModel();
  const context = new AudioContext({ sampleRate: DEEPFILTERNET_SAMPLE_RATE });
  try {
    const source = context.createMediaStreamSource(new MediaStream([raw]));
    const destination = context.createMediaStreamDestination();
    const worklet = await createDeepFilterNetAudioWorklet(context, { wasmUrl, modelUrl, onOverload });
    source.connect(worklet.node).connect(destination);
    await worklet.ready;
    await context.resume();
    const [track] = destination.stream.getAudioTracks();
    if (!track) throw new Error("DeepFilterNet made no track");
    const stop = track.stop.bind(track);
    track.stop = () => {
      stop();
      worklet.dispose();
      source.disconnect();
      raw.stop();
      context.close().catch(() => {});
    };
    return track;
  } catch (error) {
    context.close().catch(() => {});
    throw error;
  }
}
