import { describe, expect, it } from "vitest";
import { themedColor } from "./presence";

describe("presence colours", () => {
  it("draws palette colours through their theme tokens", () => {
    expect(themedColor("hsl(38, 85%, 50%)")).toBe(
      "var(--studio-presence-amber, hsl(38, 85%, 50%))"
    );
  });
  it("leaves the fallback and custom colours alone", () => {
    expect(themedColor("#888")).toBe("#888");
    expect(themedColor("#123456")).toBe("#123456");
  });
});
