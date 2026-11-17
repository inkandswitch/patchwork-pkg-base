import { test } from "vitest";
import assert from "node:assert/strict";

// a swap imports every module again from a new url (lattice/dev-swap.js): two
// imports by different urls are two modules, as they are then
test("a second version of a module gets the same lasting value", async () => {
  const first = await import("../src/engine/lasting.js?first");
  const second = await import("../src/engine/lasting.js?second");
  assert.notEqual(first, second);
  let made = 0;
  const a = first.lasting("test:thing", () => ({ n: ++made }));
  const b = second.lasting("test:thing", () => ({ n: ++made }));
  assert.equal(a, b);
  assert.equal(made, 1);
});

test("each key is its own", async () => {
  const { lasting } = await import("../src/engine/lasting.js");
  assert.notEqual(
    lasting("test:one", () => ({})),
    lasting("test:two", () => ({})),
  );
});
