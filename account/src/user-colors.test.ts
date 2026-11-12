import { describe, expect, it } from "vitest";
import { USER_COLOR_PALETTE, themedColor } from "./user-colors";

describe("themedColor", () => {
  it("draws a palette colour through its theme token, falling back to itself", () => {
    expect(themedColor("hsl(200, 70%, 50%)")).toBe(
      "var(--studio-presence-sky-blue, hsl(200, 70%, 50%))"
    );
    expect(themedColor("hsl(200,70%,50%)")).toBe(
      "var(--studio-presence-sky-blue, hsl(200,70%,50%))"
    );
  });

  it("has a token for every palette colour", () => {
    for (const c of USER_COLOR_PALETTE)
      expect(themedColor(c.value)).toMatch(/^var\(--studio-presence-[a-z-]+, /);
  });

  it("leaves custom colours alone", () => {
    expect(themedColor("#ff00aa")).toBe("#ff00aa");
    expect(themedColor("hsl(201, 70%, 50%)")).toBe("hsl(201, 70%, 50%)");
  });
});
