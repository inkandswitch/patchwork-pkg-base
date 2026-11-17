import { describe, expect, test } from "vitest";
import { ease, follow } from "../src/engine/smooth.js";

const face = (x) => [{ x, y: 0.5, z: 0 }, { x: x + 0.1, y: 0.6, z: 0.1 }];

describe("easing", () => {
  test("the first look is as it is", () => {
    expect(ease(null, face(0.4))).toEqual(face(0.4));
  });
  test("each look's only part of the way", () => {
    const [a] = ease(face(0.2), face(0.4), 0.5);
    expect(a.x).toBeCloseTo(0.3);
  });
  test("no face is no face", () => {
    expect(ease(face(0.2), null)).toBeNull();
  });
  test("a different number of points starts over", () => {
    expect(ease(face(0.2).slice(1), face(0.4))).toEqual(face(0.4));
  });
});

describe("following", () => {
  test("a face missed once or twice is held, not lost", () => {
    let state = follow({ landmarks: null, missed: 0 }, face(0.3));
    for (let i = 0; i < 4; i++) state = follow(state, null);
    expect(state.landmarks).toEqual(face(0.3));
  });
  test("gone for longer, it's gone", () => {
    let state = follow({ landmarks: null, missed: 0 }, face(0.3));
    for (let i = 0; i < 5; i++) state = follow(state, null);
    expect(state.landmarks).toBeNull();
  });
  test("found again, the count starts over", () => {
    let state = follow({ landmarks: null, missed: 0 }, face(0.3));
    state = follow(state, null);
    state = follow(state, face(0.3));
    expect(state.missed).toBe(0);
  });
});
