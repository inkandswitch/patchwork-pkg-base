import { test } from "vitest";
import assert from "node:assert/strict";
import { ringWave, louder, edgeAt, wiggle, LOUDER_FLOOR } from "../src/engine/wiggle.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

// a sine `cycles` times over `length`, `phase` in
const sine = (length, cycles, amplitude = 1, phase = 0) =>
  Float32Array.from({ length }, (_, i) => amplitude * Math.sin(phase + (2 * Math.PI * cycles * i) / length));

test("wiggle: silence is flat", () => {
  const values = ringWave(new Float32Array(2048), 160, 1024);
  assert.equal(values.length, 160);
  assert.ok(values.every((value) => value === 0));
});

test("wiggle: the waveform goes round, the same both sides, so its ends meet", () => {
  const values = ringWave(sine(2048, 16), 160, 1024);
  for (let i = 1; i < 80; i++) assert.equal(values[i], values[160 - i]);
  assert.ok(Math.max(...values) > 0.8 && Math.min(...values) < -0.8, "it swings both ways");
});

test("wiggle: it starts where the sound goes up through silence, so it holds still", () => {
  const a = ringWave(sine(2048, 16, 1, 0.5), 160, 1024);
  const b = ringWave(sine(2048, 16, 1, 2.5), 160, 1024);
  for (let i = 0; i < 160; i++) assert.ok(Math.abs(a[i] - b[i]) < 0.15, `point ${i}: ${a[i]} ≈ ${b[i]}`);
  // its first stretch is the start of a rise
  assert.ok(a[0] >= 0 && a[0] < 0.35, `from silence: ${a[0]}`);
});

test("wiggle: quiet's made as loud as loud, but hum isn't", () => {
  const quiet = louder([0.1, -0.05, 0]);
  close(quiet.values[0], 1);
  close(quiet.values[1], -0.5);
  const hum = louder([LOUDER_FLOOR / 3]);
  close(hum.values[0], 1 / 3);
  // after something loud, quiet's quiet, for a while
  const after = louder([0.1], 1);
  assert.ok(after.values[0] < 0.2);
  assert.ok(after.loudest < 1);
});

test("wiggle: round a circle, every point's on it and out's away from the middle", () => {
  for (let i = 0; i < 40; i++) {
    const at = edgeAt(100, 100, 50, i / 40);
    close(Math.hypot(at.x, at.y), 50);
    close(at.nx, at.x / 50);
    close(at.ny, at.y / 50);
  }
  const bottom = edgeAt(100, 100, 50, 0);
  close(bottom.x, 0);
  close(bottom.y, 50);
  const top = edgeAt(100, 100, 50, 0.5);
  close(top.x, 0);
  close(top.y, -50);
});

test("wiggle: round a box, its edges, and the left side first", () => {
  const left = edgeAt(200, 100, 10, 0.25);
  close(left.x, -100);
  assert.equal(left.nx, -1);
  const right = edgeAt(200, 100, 10, 0.75);
  close(right.x, 100);
  assert.equal(right.nx, 1);
  const square = edgeAt(200, 100, 0, 0.1);
  assert.ok(Math.abs(square.x) <= 100 && Math.abs(square.y) <= 50);
});

test("wiggle: points sit out from the edge, swinging either way", () => {
  const points = wiggle(100, 100, 50, [0, 1, 0, -1], 8, 5);
  close(Math.hypot(...points[0]), 58);
  close(Math.hypot(...points[1]), 63);
  close(Math.hypot(...points[3]), 53);
});
