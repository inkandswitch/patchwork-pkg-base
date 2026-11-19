import { afterEach, describe, expect, test } from "vitest";
import { forgetEveryone, forgetGone, hearMessage, peopleAt } from "./presence.ts";

const P = "patchwork:presence";
const folder = "automerge:folder";
const doc = "automerge:doc";
const room = "automerge:room";
const ana = { contact: "automerge:ana", name: "ana", colour: "", avatar: "" };
const mimi = { contact: "automerge:mimi", name: "mimi", colour: "", avatar: "" };
const names = (list: { name: string }[]) => list.map((who) => who.name);

afterEach(forgetEveryone);

describe("who's where", () => {
  test("looking at a doc, and in a call in one, each shown at its own row", () => {
    hearMessage(folder, { [P]: "here", from: "a:doc", who: ana, doc: `${doc}#heads` });
    hearMessage(folder, { [P]: "here", from: "m:call", who: mimi, call: room });
    expect(names(peopleAt(doc).looking)).toEqual(["ana"]);
    expect(peopleAt(doc).calling).toEqual([]);
    expect(names(peopleAt(room).calling)).toEqual(["mimi"]);
  });

  test("someone looking at the doc their call's in is shown once, in the call", () => {
    hearMessage(folder, { [P]: "here", from: "a:doc", who: ana, doc: room });
    hearMessage(folder, { [P]: "here", from: "a:call", who: ana, call: room });
    expect(names(peopleAt(room).calling)).toEqual(["ana"]);
    expect(peopleAt(room).looking).toEqual([]);
  });

  test("a closed folder shows everyone anywhere in it", () => {
    hearMessage(folder, { [P]: "here", from: "a:doc", who: ana, doc });
    hearMessage(folder, { [P]: "here", from: "m:call", who: mimi, call: room });
    expect(peopleAt(folder).looking).toEqual([]);
    const inside = peopleAt(folder, { inside: true });
    expect(names(inside.calling)).toEqual(["mimi"]);
    expect(names(inside.looking)).toEqual(["ana"]);
  });

  test("bye from a folder, or not heard from in a while, and they're gone", () => {
    hearMessage(folder, { [P]: "here", from: "a:doc", who: ana, doc }, 0);
    hearMessage(folder, { [P]: "bye", from: "a:doc" });
    expect(peopleAt(doc).looking).toEqual([]);
    hearMessage(folder, { [P]: "here", from: "a:doc", who: ana, doc }, 0);
    forgetGone(20_000);
    expect(peopleAt(doc).looking).toEqual([]);
  });

  test("nonsense is nothing", () => {
    hearMessage(folder, { [P]: "here", from: "x", who: { name: "no contact" }, doc });
    hearMessage(folder, { [P]: "wave", from: "x", who: ana, doc });
    hearMessage(folder, "hello");
    expect(peopleAt(doc).looking).toEqual([]);
  });
});
