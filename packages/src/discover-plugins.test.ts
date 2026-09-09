import { describe, expect, it } from "vitest";
import { discoverHttpPlugins } from "./discover-plugins.ts";

describe("discoverHttpPlugins", () => {
  it("imports package plugin descriptors directly", async () => {
    const url = "data:text/javascript,export const plugins = [{ id: 'example' }]";

    await expect(discoverHttpPlugins(url)).resolves.toEqual([{ id: "example" }]);
  });
});
