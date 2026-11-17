import { expect, test } from "vitest";
import { COLOURS, themed } from "../src/ui/colour.js";

test("a palette colour is drawn as its theme token, as cursors draw it", () => {
  expect(themed("hsl(200, 70%, 50%)")).toBe("var(--studio-presence-sky-blue, hsl(200, 70%, 50%))");
  expect(themed("hsl(200,70%,50%)")).toBe("var(--studio-presence-sky-blue, hsl(200,70%,50%))");
  for (const [name, value] of COLOURS) expect(themed(value)).toMatch(/^var\(--studio-presence-[a-z-]+, /);
});

test("any other colour is as it is", () => {
  expect(themed("#ff00aa")).toBe("#ff00aa");
  expect(themed("hsl(201, 70%, 50%)")).toBe("hsl(201, 70%, 50%)");
});
