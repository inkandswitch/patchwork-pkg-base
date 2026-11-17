// the call's sounds: one as anyone comes into your call, another as anyone
// goes. you joining is a join, and hanging up a leave. whoever's there
// already as you join isn't arriving (they come in over the first moment,
// as their connections are made). someone's who they are (their contact),
// so two tabs of theirs are one, and a connection that drops and is made
// again isn't them going: a leave waits a moment, unless they said bye
import { createEffect, createRoot, on } from "solid-js";
import { call, onBye } from "./call.js";

// how long joining takes to bring in who was there already
export const SETTLE = 2500;
// how long someone's gone before they've gone (a reconnect is quicker; the
// one who offers waits for them to say they're here again, every 3s)
export const GRACE = 4000;

const SOUNDS = {
  join: new URL("../sounds/join.mp3", import.meta.url).href,
  leave: new URL("../sounds/leave.mp3", import.meta.url).href,
};
const playing = {};

/** play the `join` or `leave` sound (from the top, if it's playing already) */
export function playSound(name) {
  try {
    const audio = (playing[name] ??= new Audio(SOUNDS[name]));
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch {}
}

const keyOf = (person) => person.contact || person.id;

/**
 * play the call's sounds as people come and go, till what this returns is
 * called. what it's told and does can be other than the call's (for tests)
 */
export function chimes({
  room = () => call.get()?.id ?? null,
  people = call.peers,
  byes = onBye,
  play = playSound,
  settle = SETTLE,
  grace = GRACE,
  now = () => Date.now(),
} = {}) {
  // who's in it, by who they are: how many of their tabs
  let here = new Map();
  // who's gone, waiting to be sure: key → timer
  const going = new Map();
  // who said bye
  const said = new Set();
  let joinedAt = 0;

  function forget() {
    for (const timer of going.values()) clearTimeout(timer);
    going.clear();
    said.clear();
    here = new Map();
  }

  const stopByes = byes((person) => said.add(keyOf(person)));

  const dispose = createRoot((dispose) => {
    createEffect(
      on(room, (id, was) => {
        if (id === was) return;
        forget();
        joinedAt = now();
        if (id) play("join");
        else if (was) play("leave");
      }),
    );

    createEffect(() => {
      const next = new Map();
      for (const person of people()) {
        const key = keyOf(person);
        next.set(key, (next.get(key) ?? 0) + 1);
      }
      for (const key of next.keys()) {
        if (here.has(key)) continue;
        said.delete(key);
        if (going.has(key)) {
          // back before they'd gone
          clearTimeout(going.get(key));
          going.delete(key);
        } else if (now() - joinedAt >= settle) play("join");
      }
      for (const key of here.keys()) {
        if (next.has(key) || going.has(key)) continue;
        if (said.delete(key)) {
          play("leave");
          continue;
        }
        going.set(
          key,
          setTimeout(() => {
            going.delete(key);
            play("leave");
          }, grace),
        );
      }
      here = next;
    });
    return dispose;
  });

  return () => {
    stopByes();
    dispose();
    forget();
  };
}
