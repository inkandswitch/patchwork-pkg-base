// presence beyond a doc (a copy of the providers package's presence.ts: it
// can't be imported. keep the message the same in both). every folder that
// holds your call's doc, as far as can be found from the folders open in this
// repo (each searched all the way down, folders only), is told you're in a
// call there, so a list of folders (the sideboard) can show it, closed or
// open, without loading the doc:
//
//   { "patchwork:presence": "here", from, who, call }
//   { "patchwork:presence": "bye", from }
//
// its own key, not the call's (call.js KEY): a folder that's a call's room
// itself mustn't hear this as someone in its call

export const PRESENCE = "patchwork:presence";
export const PRESENCE_EVERY = 5_000;
// how often the folders holding it are looked for again (they change)
export const PRESENCE_LOOK = 30_000;
const MOST_FOLDERS = 2_000;

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
 * every folder under `roots`, all the way down, loading the folders (only)
 * it hasn't got, a level at a time, each once, no more than `most`
 */
export async function folderTree(repo, roots, most = MOST_FOLDERS) {
  const seen = new Map();
  let level = roots;
  while (level.length && seen.size < most) {
    const next = [];
    for (const handle of level) {
      const url = bare(handle.url);
      if (seen.has(url) || seen.size >= most) continue;
      seen.set(url, handle);
      for (const link of docsOf(handle) ?? []) {
        if (link?.type !== "folder" || typeof link.url !== "string" || seen.has(bare(link.url))) continue;
        next.push(Promise.resolve(repo.find(link.url)).catch(() => null));
      }
    }
    level = (await Promise.all(next)).filter(Boolean);
  }
  return [...seen.values()];
}

/**
 * tell the folders holding where you are (`where()`: {call}, or null) that
 * you're there, as `who()`, every PRESENCE_EVERY and on `update()`. which
 * folders is looked for (folderTree, from every folder open) as where you
 * are changes, and every PRESENCE_LOOK. folders it's no longer in are told
 * bye, and all of them on `stop()`
 */
export function announce({ repo, from, where, who, every = PRESENCE_EVERY, look = PRESENCE_LOOK }) {
  let told = new Map();
  let folders = [];
  let foundFor = null;
  let looking = 0;
  const target = () => {
    const now = where();
    return now ? bare(now.doc ?? now.call) : null;
  };
  async function find(url) {
    const r = repo();
    if (!r) return;
    const mine = ++looking;
    const roots = Object.values(r.handles ?? {}).filter((handle) => docsOf(handle) !== null);
    const tree = await folderTree(r, roots);
    if (mine !== looking) return;
    folders = foldersHolding(tree, url);
    foundFor = url;
    tell();
  }
  const send = (handle, message) => {
    try {
      handle.broadcast({ [PRESENCE]: message.bye ? "bye" : "here", from, ...(message.bye ? {} : message) });
    } catch {}
  };
  function tell() {
    const now = where();
    const me = who();
    const url = target();
    const holding = url && me && foundFor === url ? folders : [];
    const next = new Map(holding.map((handle) => [handle.url, handle]));
    for (const [url, handle] of told) if (!next.has(url)) send(handle, { bye: true });
    for (const handle of next.values()) send(handle, { who: me, ...now });
    told = next;
  }
  function update() {
    const url = target();
    if (url && url !== foundFor) find(url);
    tell();
  }
  const timer = setInterval(tell, every);
  const again = setInterval(() => {
    const url = target();
    if (url) find(url);
  }, look);
  update();
  return {
    update,
    stop() {
      clearInterval(timer);
      clearInterval(again);
      looking++;
      for (const handle of told.values()) send(handle, { bye: true });
      told = new Map();
    },
  };
}
