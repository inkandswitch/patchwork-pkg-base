import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { chimes } from "../src/engine/chimes.js";

let room, setRoom, people, setPeople, played, bye, clock, stop;
const ana = { id: "a1", contact: "automerge:ana" };
const anaAgain = { id: "a2", contact: "automerge:ana" };
const bo = { id: "b1", contact: "" };

beforeEach(() => {
  vi.useFakeTimers();
  [room, setRoom] = createSignal(null);
  [people, setPeople] = createSignal([]);
  played = [];
  clock = 0;
  stop = chimes({
    room,
    people,
    byes: (fn) => ((bye = fn), () => (bye = null)),
    play: (name) => played.push(name),
    settle: 1000,
    grace: 3000,
    now: () => clock,
  });
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

/** join, and let whoever was there already come in */
function joined(...already) {
  setRoom("call-1");
  setPeople(already);
  clock += 1000;
  played = [];
}

describe("the call's sounds", () => {
  test("you joining is a join, and hanging up a leave", () => {
    setRoom("call-1");
    expect(played).toEqual(["join"]);
    setRoom(null);
    expect(played).toEqual(["join", "leave"]);
  });

  test("whoever's there already as you join isn't arriving", () => {
    setRoom("call-1");
    setPeople([ana, bo]);
    expect(played).toEqual(["join"]);
  });

  test("someone coming in after is", () => {
    joined(ana);
    setPeople([ana, bo]);
    expect(played).toEqual(["join"]);
  });

  test("someone saying bye leaves straight away", () => {
    joined(ana, bo);
    bye(bo);
    setPeople([ana]);
    expect(played).toEqual(["leave"]);
  });

  test("someone lost leaves once they've been gone a while", () => {
    joined(ana);
    setPeople([]);
    expect(played).toEqual([]);
    vi.advanceTimersByTime(3000);
    expect(played).toEqual(["leave"]);
  });

  test("a connection made again soon is neither", () => {
    joined(ana);
    setPeople([]);
    vi.advanceTimersByTime(1500);
    setPeople([ana]);
    vi.advanceTimersByTime(5000);
    expect(played).toEqual([]);
  });

  test("two tabs of one person are one: the second's nothing, and so is either going", () => {
    joined(ana);
    setPeople([ana, anaAgain]);
    setPeople([anaAgain]);
    vi.advanceTimersByTime(5000);
    expect(played).toEqual([]);
    setPeople([]);
    vi.advanceTimersByTime(3000);
    expect(played).toEqual(["leave"]);
  });

  test("hanging up, nobody's left after you", () => {
    joined(ana, bo);
    setRoom(null);
    setPeople([]);
    vi.advanceTimersByTime(5000);
    expect(played).toEqual(["leave"]);
  });
});
