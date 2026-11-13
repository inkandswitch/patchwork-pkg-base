import { test } from "vitest";
import assert from "node:assert/strict";
import { keep, kept } from "../src/engine/kept.js";
import { REJOIN_WITHIN, callToRejoin, forgetCall, keepCall, leavingCall } from "../src/engine/rejoin.js";

function memory() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    items,
  };
}

test("kept: what's kept comes back, and nothing is the fallback", () => {
  const storage = memory();
  assert.equal(kept("k", "none", storage), "none");
  keep("k", { a: 1 }, storage);
  assert.deepEqual(kept("k", null, storage), { a: 1 });
  keep("k", null, storage);
  assert.equal(storage.items.has("k"), false);
});

test("kept: storage that throws, or isn't json, is the fallback", () => {
  const broken = {
    getItem() {
      throw new Error("no");
    },
    setItem() {
      throw new Error("no");
    },
  };
  assert.equal(kept("k", 7, broken), 7);
  keep("k", 1, broken);
  const storage = memory();
  storage.setItem("k", "{not json");
  assert.equal(kept("k", 7, storage), 7);
});

test("rejoin: a call left by a reload is rejoined, as it was", () => {
  const storage = memory();
  keepCall({ room: "automerge:room", camera: true, mic: false }, { storage });
  // still in it: not one to rejoin
  assert.equal(callToRejoin("automerge:room", { now: 5000, storage }), null);
  leavingCall({ at: 5000, storage });
  assert.deepEqual(callToRejoin("automerge:room", { now: 6000, storage }), { camera: true, mic: false });
  assert.equal(callToRejoin("automerge:other", { now: 6000, storage }), null);
});

test("rejoin: not once it's too long ago, nor after hanging up", () => {
  const storage = memory();
  keepCall({ room: "automerge:room", camera: false, mic: true }, { storage });
  leavingCall({ at: 0, storage });
  assert.equal(callToRejoin("automerge:room", { now: REJOIN_WITHIN + 1, storage }), null);
  assert.ok(callToRejoin("automerge:room", { now: REJOIN_WITHIN, storage }));
  forgetCall({ storage });
  assert.equal(callToRejoin("automerge:room", { now: 1, storage }), null);
});

test("rejoin: leaving with no call kept keeps nothing", () => {
  const storage = memory();
  leavingCall({ at: 1, storage });
  assert.equal(storage.items.size, 0);
});
