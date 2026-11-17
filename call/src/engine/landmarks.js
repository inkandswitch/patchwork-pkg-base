// the face landmarker's model (google's mediapipe, 478 points of a face), for
// the effects that need it. like DeepFilterNet's (noise.js): downloaded the
// first time it's wanted, checked, and kept in indexeddb. the worker gets its
// bytes; it fetches the wasm itself (effects.worker.js)
import { createRoot, createSignal } from "solid-js";
import { lasting } from "./lasting.js";

export const MODEL = {
  url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  name: "face_landmarker.task",
  size: 3758596,
  sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
};

const DB = "patchwork-call:landmarks";
const STORE = "files";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const keyOf = () => `${MODEL.name}@${MODEL.sha256}`;

async function kept() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(keyOf());
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  } catch {
    return null;
  }
}

async function keep(bytes) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(bytes, keyOf());
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    }).finally(() => db.close());
  } catch (error) {
    // not kept (private browsing, say): it's downloaded again next time
    console.warn("[call] couldn't keep the face model", error);
  }
}

async function hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// how it's going, to show: {state: "none" | "loading" | "ready" | "failed",
// got, total, problem}
const status = lasting("patchwork-call:landmarks:status", () =>
  createRoot(() => createSignal({ state: "none", got: 0, total: MODEL.size, problem: null })),
);
export const download = status[0];
const setDownload = status[1];

const loading = lasting("patchwork-call:landmarks:loading", () => ({ promise: null }));

/** the model's bytes (an ArrayBuffer), downloaded the first time */
export function loadModel() {
  loading.promise ??= (async () => {
    const had = await kept();
    if (had) {
      setDownload({ state: "ready", got: MODEL.size, total: MODEL.size, problem: null });
      return had;
    }
    setDownload({ state: "loading", got: 0, total: MODEL.size, problem: null });
    const response = await fetch(MODEL.url);
    if (!response.ok || !response.body) throw new Error(`couldn't download the model (${response.status})`);
    const chunks = [];
    let length = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
      setDownload({ state: "loading", got: length, total: MODEL.size, problem: null });
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    if ((await hex(bytes)) !== MODEL.sha256) throw new Error("the face model isn't the one it should be: not using it");
    await keep(bytes.buffer);
    setDownload({ state: "ready", got: MODEL.size, total: MODEL.size, problem: null });
    return bytes.buffer;
  })().catch((error) => {
    loading.promise = null;
    setDownload({ state: "failed", got: 0, total: MODEL.size, problem: String(error?.message ?? error) });
    throw error;
  });
  return loading.promise;
}
