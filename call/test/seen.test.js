import { test } from "vitest";
import assert from "node:assert/strict";
import { measureFaces, worthSaying } from "../src/engine/seen.js";

test("bigger is said at once, so it sharpens", () => {
  assert.equal(worthSaying({ a: 60 }, { a: 360 }, { a: 60 }), true);
  assert.equal(worthSaying({ a: 360 }, { a: null }, { a: 360 }), true);
  // back from not looking
  assert.equal(worthSaying({ a: 0 }, { a: 240 }, null), true);
});

test("smaller waits till it's settled", () => {
  assert.equal(worthSaying({ a: 360 }, { a: 60 }, { a: 240 }), false);
  assert.equal(worthSaying({ a: 360 }, { a: 60 }, { a: 60 }), true);
});

test("the same as was said isn't said again", () => {
  assert.equal(worthSaying({ a: 60, b: null }, { a: 60, b: null }, { a: 60, b: null }), false);
});

test("someone new is said once it's settled", () => {
  assert.equal(worthSaying({}, { a: 240 }, null), false);
  assert.equal(worthSaying({}, { a: 240 }, { a: 240 }), true);
});

test("each face's biggest, but not yours", () => {
  const root = document.createElement("div");
  for (const [id, height] of [
    ["p1", 26],
    ["p1", 150],
    ["me", 400],
  ]) {
    const face = document.createElement("span");
    face.className = "patchwork-call-face";
    face.dataset.callId = id;
    face.getBoundingClientRect = () => ({ height });
    face.checkVisibility = () => true;
    root.append(face);
  }
  const seen = measureFaces(root);
  assert.equal(seen.p1, 150);
  assert.equal("me" in seen, false);
});
