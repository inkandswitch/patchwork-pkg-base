// presence beyond a doc (a copy of the providers package's presence.ts: it
// can't be imported. keep the message the same in both). the folders open in
// this repo that hold your call's doc are told you're in a call there, so a
// list of folders (the sideboard) can show it without loading the doc:
//
//   { "patchwork:presence": "here", from, who, call }
//   { "patchwork:presence": "bye", from }
//
// its own key, not the call's (call.js KEY): a folder that's a call's room
// itself mustn't hear this as someone in its call

export const PRESENCE = "patchwork:presence";
export const PRESENCE_EVERY = 5_000;

const bare = (url) => String(url).split(/[#/]/, 1)[0];

function docsOf(handle) {
  try {
    if (!handle.isReady()) return null;
    const docs = handle.doc()?.docs;
    return Array.isArray(docs) ? docs : null;
  } catch {
    return null;
  }
}

/** the open folders (of `handles`) that hold `url`, directly or through other open folders */
export function foldersHolding(handles, url) {
  const parents = new Map();
  for (const handle of handles) {
    for (const link of docsOf(handle) ?? []) {
      if (typeof link?.url !== "string") continue;
      const child = bare(link.url);
      parents.set(child, [...(parents.get(child) ?? []), handle]);
    }
  }
  const found = new Set();
  const queue = [bare(url)];
  while (queue.length) {
    for (const parent of parents.get(queue.shift()) ?? []) {
      if (found.has(parent)) continue;
      found.add(parent);
      queue.push(bare(parent.url));
    }
  }
  return [...found];
}

/**
 * tell the folders holding where you are (`where()`: {call}, or null) that
 * you're there, as `who()`, every PRESENCE_EVERY and on `update()`. folders
 * it's no longer in are told bye, and all of them on `stop()`
 */
export function announce({ repo, from, where, who, every = PRESENCE_EVERY }) {
  let told = new Map();
  const send = (handle, message) => {
    try {
      handle.broadcast({ [PRESENCE]: message.bye ? "bye" : "here", from, ...(message.bye ? {} : message) });
    } catch {}
  };
  function update() {
    const now = where();
    const me = who();
    const open = repo()?.handles;
    const url = now && (now.doc ?? now.call);
    const folders = url && me && open ? foldersHolding(Object.values(open), url) : [];
    const next = new Map(folders.map((handle) => [handle.url, handle]));
    for (const [url, handle] of told) if (!next.has(url)) send(handle, { bye: true });
    for (const handle of next.values()) send(handle, { who: me, ...now });
    told = next;
  }
  const timer = setInterval(update, every);
  update();
  return {
    update,
    stop() {
      clearInterval(timer);
      for (const handle of told.values()) send(handle, { bye: true });
      told = new Map();
    },
  };
}
