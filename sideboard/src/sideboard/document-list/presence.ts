// Who's where, among the folders the list has open. Other tabs tell the
// folders holding the doc they're looking at, and the one their call's in
// (the providers package's selected-doc provider, and the call package: see
// providers/src/presence.ts for the message). This only listens, on the
// folder handles the list loads anyway, so it costs no doc loads, and with
// neither of those around, nobody's anywhere.
import type { DocHandle } from "@automerge/automerge-repo/slim";
import { createSignal } from "solid-js";

const PRESENCE = "patchwork:presence";
// not heard from in this long (they tell every 5s): gone
const GONE_AFTER = 15_000;

export type Who = { contact: string; name: string; colour: string; avatar: string };
type Heard = { who: Who; doc: string | null; call: string | null; at: number; on: Set<string> };

const bare = (url: string) => url.split(/[#/]/, 1)[0];
const text = (value: unknown, most = 200) => (typeof value === "string" ? value.slice(0, most) : "");

// each tab's announcers, by their `from`
const heard = new Map<string, Heard>();
const [version, setVersion] = createSignal(0);
const changed = () => setVersion((n) => n + 1);

function whoFrom(value: unknown): Who | null {
  if (!value || typeof value !== "object") return null;
  const who = value as Record<string, unknown>;
  const contact = text(who.contact);
  if (!contact.startsWith("automerge:")) return null;
  const avatar = text(who.avatar);
  return {
    contact,
    name: text(who.name) || "anonymous",
    colour: text(who.colour, 100),
    avatar: avatar.startsWith("automerge:") ? avatar : "",
  };
}

/** what was heard on `folder` (a bare url): someone's there, or gone */
export function hearMessage(folder: string, message: unknown, now = Date.now()) {
  if (!message || typeof message !== "object") return;
  const said = message as Record<string, unknown>;
  const kind = said[PRESENCE];
  const from = text(said.from);
  if (!from || (kind !== "here" && kind !== "bye")) return;
  const had = heard.get(from);
  if (kind === "bye") {
    if (!had?.on.delete(folder)) return;
    if (!had.on.size) heard.delete(from);
    return changed();
  }
  const who = whoFrom(said.who);
  if (!who) return;
  const doc = text(said.doc) ? bare(text(said.doc)) : null;
  const call = text(said.call) ? bare(text(said.call)) : null;
  const same =
    had &&
    had.doc === doc &&
    had.call === call &&
    had.on.has(folder) &&
    had.who.name === who.name &&
    had.who.colour === who.colour &&
    had.who.avatar === who.avatar;
  heard.set(from, { who, doc, call, at: now, on: new Set([...(had?.on ?? []), folder]) });
  if (!same) changed();
}

/** everyone not heard from in a while is gone */
export function forgetGone(now = Date.now()) {
  let any = false;
  for (const [from, person] of heard) {
    if (now - person.at > GONE_AFTER) {
      heard.delete(from);
      any = true;
    }
  }
  if (any) changed();
}

// the folders being listened to: how many rows want each, and how to stop
const listening = new Map<string, { count: number; stop: () => void }>();
let pruning: ReturnType<typeof setInterval> | null = null;

/** listen on `handle` (a folder) for who's in it, till what this returns is called */
export function hearFolder(handle: DocHandle<unknown>): () => void {
  const folder = bare(handle.url);
  const held = listening.get(folder);
  if (held) held.count++;
  else {
    const listener = ({ message }: { message: unknown }) => hearMessage(folder, message);
    handle.on("ephemeral-message", listener as never);
    listening.set(folder, { count: 1, stop: () => handle.off("ephemeral-message", listener as never) });
    pruning ??= setInterval(() => forgetGone(), 5_000);
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const now = listening.get(folder);
    if (!now || --now.count > 0) return;
    now.stop();
    listening.delete(folder);
    if (!listening.size && pruning) {
      clearInterval(pruning);
      pruning = null;
    }
  };
}

const myContact = () =>
  (globalThis as { accountDocHandle?: DocHandle<{ contactUrl?: string }> }).accountDocHandle?.doc()?.contactUrl ?? null;

/**
 * who's at `url` (read in a reactive scope): in a call there, and looking at
 * it, each person once, not you. `inside`, for a folder that's closed:
 * everyone anywhere in it too
 */
export function peopleAt(url: string, { inside = false } = {}): { calling: Who[]; looking: Who[] } {
  version();
  const at = bare(url);
  const me = myContact();
  const people = new Map<string, { who: Who; calling: boolean }>();
  for (const person of heard.values()) {
    if (person.who.contact === me) continue;
    const calling = person.call === at || (inside && !!person.call && person.on.has(at));
    const looking = person.doc === at || (inside && !!person.doc && person.on.has(at));
    if (!calling && !looking) continue;
    const had = people.get(person.who.contact);
    people.set(person.who.contact, { who: person.who, calling: calling || !!had?.calling });
  }
  const all = [...people.values()];
  return {
    calling: all.filter((person) => person.calling).map((person) => person.who),
    looking: all.filter((person) => !person.calling).map((person) => person.who),
  };
}

/** for tests: nobody heard */
export function forgetEveryone() {
  heard.clear();
  changed();
}
