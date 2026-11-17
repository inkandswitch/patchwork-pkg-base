import { describe, expect, test } from "vitest";
import { place, twitch } from "../src/ears.js";
import { draw } from "../src/effect.js";
import { plugins } from "../src/index.js";

// a face on a 400 x 400 picture: eyes level, its edges 200 apart, forehead
// above. `by` scales it about its middle, `roll` turns it (radians)
function face({ by = 1, roll = 0, at = { x: 0.5, y: 0.5 } } = {}) {
  const points = Array.from({ length: 478 }, () => ({ x: at.x, y: at.y, z: 0 }));
  const set = (n, x, y) => {
    // (x, y) in face units, from its middle: 1 is half the face's width
    const rx = (x * Math.cos(roll) - y * Math.sin(roll)) * by * 0.25;
    const ry = (x * Math.sin(roll) + y * Math.cos(roll)) * by * 0.25;
    points[n] = { x: at.x + rx, y: at.y + ry, z: 0 };
  };
  set(33, -0.6, -0.2);
  set(263, 0.6, -0.2);
  set(234, -1, 0);
  set(454, 1, 0);
  set(54, -0.7, -1.2);
  set(103, -0.4, -1.3);
  set(284, 0.7, -1.2);
  set(332, 0.4, -1.3);
  set(205, -0.7, 0.4);
  set(425, 0.7, 0.4);
  set(1, 0, 0.1);
  return points;
}

describe("placing ears", () => {
  test("no face, no ears", () => {
    expect(place(null, 400, 400)).toBeNull();
    expect(place([], 400, 400)).toBeNull();
    expect(place(face(), 0, 400)).toBeNull();
  });

  test("a face that's no width has none either", () => {
    const flat = face();
    flat[454] = flat[234];
    expect(place(flat, 400, 400)).toBeNull();
  });

  test("two ears, over the forehead, one each side, tips up", () => {
    const { ears } = place(face(), 400, 400);
    expect(ears).toHaveLength(2);
    const [left, right] = ears;
    expect(left.tip.x).toBeLessThan(200);
    expect(right.tip.x).toBeGreaterThan(200);
    // the forehead's at y = 200 - 1.25 * 100
    expect(left.tip.y).toBeLessThan(75);
    expect(left.tip.y).toBeCloseTo(right.tip.y, 3);
    for (const ear of ears) expect(ear.base[0].y).toBeGreaterThan(ear.tip.y);
  });

  test("they lean outward a little, not straight up", () => {
    const [left, right] = place(face(), 400, 400).ears;
    const rootLeft = (left.base[0].x + left.base[1].x) / 2;
    const rootRight = (right.base[0].x + right.base[1].x) / 2;
    expect(left.tip.x).toBeLessThan(rootLeft);
    expect(right.tip.x).toBeGreaterThan(rootRight);
  });

  test("the pink is inside the ear", () => {
    const [ear] = place(face(), 400, 400).ears;
    expect(ear.inner.tip.y).toBeGreaterThan(ear.tip.y);
    expect(ear.inner.base[0].y).toBeLessThanOrEqual(ear.base[0].y + 1e-9);
  });

  test("they're as big as the face is wide", () => {
    const small = place(face({ by: 0.5 }), 400, 400);
    const big = place(face({ by: 1 }), 400, 400);
    expect(big.size).toBeCloseTo(200);
    expect(small.size).toBeCloseTo(100);
    const height = (found) => found.ears[0].base[0].y - found.ears[0].tip.y;
    expect(height(big) / height(small)).toBeCloseTo(2, 5);
  });

  test("a tilted head tilts them with it", () => {
    const roll = Math.PI / 6;
    const found = place(face({ roll }), 400, 400);
    expect(found.roll).toBeCloseTo(roll);
    // turned clockwise: the head's top goes to the right
    const level = place(face(), 400, 400);
    const tilted = found.ears.map((ear) => ear.tip.x);
    expect(Math.min(...tilted)).toBeGreaterThan(Math.min(...level.ears.map((ear) => ear.tip.x)));
    // and the ears' own line is the eyes'
    const [a, b] = found.ears.map((ear) => ear.tip);
    expect(Math.atan2(b.y - a.y, b.x - a.x)).toBeCloseTo(roll, 1);
  });

  test("they follow the face about the picture", () => {
    const left = place(face({ at: { x: 0.3, y: 0.5 } }), 400, 400);
    const right = place(face({ at: { x: 0.7, y: 0.5 } }), 400, 400);
    expect(right.ears[0].tip.x - left.ears[0].tip.x).toBeCloseTo(160);
  });

  test("on a picture that isn't square, pixels are pixels", () => {
    const found = place(face(), 800, 400);
    expect(found.size).toBeCloseTo(400);
    expect(found.nose.x).toBeCloseTo(400);
  });

  test("whiskers: three from each cheek, going outward", () => {
    const { whiskers } = place(face(), 400, 400);
    expect(whiskers).toHaveLength(6);
    for (const whisker of whiskers.slice(0, 3)) expect(whisker.to.x).toBeLessThan(whisker.from.x);
    for (const whisker of whiskers.slice(3)) expect(whisker.to.x).toBeGreaterThan(whisker.from.x);
    // from the cheek, which is on the face's side of its edge
    expect(whiskers[0].from.x).toBeGreaterThan(100);
  });

  test("the nose's tint is on the nose", () => {
    const { nose } = place(face(), 400, 400);
    expect(nose.x).toBeCloseTo(200);
    expect(nose.y).toBeCloseTo(210);
    expect(nose.radius).toBeGreaterThan(0);
  });
});

describe("twitching", () => {
  test("mostly they're still", () => {
    expect(twitch(1000, -1)).toBe(0);
    expect(twitch(1000, 1)).toBe(0);
  });
  test("now and again one moves, and comes back", () => {
    expect(Math.abs(twitch(5200 + 125, -1))).toBeGreaterThan(0.05);
    expect(twitch(5200 + 300, -1)).toBe(0);
  });
  test("the ears move at different times", () => {
    expect(twitch(5200 + 125, 1)).toBe(0);
  });
});

describe("drawing", () => {
  const context = () => {
    const calls = [];
    return new Proxy(
      { calls },
      {
        get: (target, name) => (name === "calls" ? calls : (...args) => calls.push([name, ...args])),
        set: () => true,
      },
    );
  };

  test("with no face it draws nothing at all", () => {
    const ctx = context();
    draw(ctx, { landmarks: null, mask: null, time: 0, width: 400, height: 400 });
    expect(ctx.calls).toEqual([]);
  });

  test("with one it draws ears, a nose and whiskers, and puts the context back", () => {
    const ctx = context();
    draw(ctx, { landmarks: face(), mask: null, time: 0, width: 400, height: 400 });
    const names = ctx.calls.map(([name]) => name);
    expect(names[0]).toBe("save");
    expect(names.at(-1)).toBe("restore");
    expect(names.filter((n) => n === "fill").length).toBe(5);
    expect(names).toContain("ellipse");
    expect(names.filter((n) => n === "lineTo").length).toBeGreaterThanOrEqual(6);
  });
});

describe("the plugin", () => {
  test("says what it is and needs, and where its module is", () => {
    const [plugin] = plugins;
    expect(plugin).toMatchObject({
      type: "patchwork:call-effect",
      id: "cat-ears",
      kind: "overlay",
      needs: ["landmarks"],
      effect: "./effect.js",
    });
  });

  test("and loads the same module", async () => {
    const module = await plugins[0].load();
    expect(typeof module.draw).toBe("function");
  });
});
