import { describe, expect, test } from "vitest";
import {
  MAX_SIZE,
  MIN_SIZE,
  moved,
  onScreen,
  rowAround,
  sized,
  unplaced,
  type FacesState,
  type Person,
} from "./call-faces.ts";

const person = (key: string, me = false): Person => ({
  key,
  id: key,
  name: key,
  colour: "",
  me,
});

describe("unplaced", () => {
  test("is who's in the call and isn't on the canvas yet", () => {
    const state: FacesState = {
      here: true,
      people: [person("a", true), person("b"), person("c")],
      spots: { b: { x: 0, y: 0, size: 50 } },
    };
    expect(unplaced(state).map((p) => p.key)).toEqual(["a", "c"]);
  });
});

describe("rowAround", () => {
  test("is a row centred on the point, the same size on screen at any zoom", () => {
    const spots = rowAround([person("a"), person("b")], { x: 100, y: 50 }, 0.5, 96);
    expect(spots.a.size).toBe(192);
    expect(spots.b.size).toBe(192);
    // centred: the row's midpoint is the point, and both sit on its row
    const mid = (spots.a.x + spots.b.x + spots.b.size) / 2;
    expect(mid).toBeCloseTo(100);
    expect(spots.a.y + spots.a.size / 2).toBeCloseTo(50);
    expect(spots.b.x).toBeGreaterThan(spots.a.x + spots.a.size);
  });

  test("one person is centred on the point", () => {
    const spots = rowAround([person("a")], { x: 0, y: 0 }, 1, 100);
    expect(spots.a).toEqual({ x: -50, y: -50, size: 100 });
  });
});

describe("moving and sizing", () => {
  const spot = { x: 10, y: 20, size: 100 };
  test("moved by page units", () => {
    expect(moved(spot, 5, -5)).toEqual({ x: 15, y: 15, size: 100 });
  });
  test("sized from the corner, the top left staying", () => {
    expect(sized(spot, 30, 10)).toEqual({ x: 10, y: 20, size: 130 });
    expect(sized(spot, -30, -50)).toEqual({ x: 10, y: 20, size: 70 });
  });
  test("never too small or too big", () => {
    expect(sized(spot, -1000, -1000).size).toBe(MIN_SIZE);
    expect(sized(spot, 1e6, 1e6).size).toBe(MAX_SIZE);
  });
});

describe("onScreen", () => {
  test("pans and zooms with the camera", () => {
    const spot = { x: 10, y: 20, size: 100 };
    expect(onScreen(spot, { x: 0, y: 0, z: 1 })).toEqual({ left: 10, top: 20, size: 100 });
    expect(onScreen(spot, { x: 5, y: -20, z: 2 })).toEqual({ left: 30, top: 0, size: 200 });
  });
});
