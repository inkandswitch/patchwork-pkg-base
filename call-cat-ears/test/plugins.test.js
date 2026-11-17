import { expect, test } from "vitest";
import { plugins } from "../src/index.js";

// the call's worker imports an effect by its url. the registry's importUrl
// for a package can be its folder, not its entry, so the url's the plugin's
// own: next to the module that lists it (dist/effect.js, once built)
test("the effect's module is said by its whole url, next to this one", () => {
  const [catEars] = plugins;
  expect(catEars.effect).toBe(new URL("./effect.js", import.meta.url.replace("/test/", "/src/")).href);
  expect(() => new URL(catEars.effect)).not.toThrow();
});
