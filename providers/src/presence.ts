import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";

/**
 * Presence beyond a doc: telling the folders a doc is in that you're there,
 * so a list of folders (the sideboard) can show who's where without loading
 * every doc in it.
 *
 * On each folder that's open in this repo and holds the doc (directly, or
 * through other open folders), every few seconds, an ephemeral message:
 *
 *   { "patchwork:presence": "here", from, who, doc }   looking at `doc`
 *   { "patchwork:presence": "here", from, who, call }  in a call in `call`
 *   { "patchwork:presence": "bye", from }              gone (from that folder)
 *
 * `from` is one announcer in one tab: the selected-doc provider says `doc`,
 * the call package says `call`, each as its own `from`. `who` is
 * `{contact, name, colour, avatar}`. Someone not heard from in
 * PRESENCE_GONE is gone.
 *
 * The call package has a copy of this (it can't import it); keep the
 * message the same in both.
 */
export const PRESENCE = "patchwork:presence";
export const PRESENCE_EVERY = 5_000;
export const PRESENCE_GONE = 15_000;

export type Who = { contact: string; name: string; colour: string; avatar: string };
export type Where = { doc: string } | { call: string };

/** a doc url without its heads or path: every version of a doc is the same doc */
export const bare = (url: string) => url.split(/[#/]/, 1)[0];

type FolderLike = { docs?: { url?: unknown }[] };
const docsOf = (handle: DocHandle<unknown>): { url?: unknown }[] | null => {
  try {
    if (!handle.isReady()) return null;
    const docs = (handle.doc() as FolderLike | undefined)?.docs;
    return Array.isArray(docs) ? docs : null;
  } catch {
    return null;
  }
};

/**
 * the open folders (of `handles`) that hold `url`, directly or through other
 * open folders. nothing is loaded to find out
 */
export function foldersHolding(handles: Iterable<DocHandle<unknown>>, url: string): DocHandle<unknown>[] {
  const parents = new Map<string, DocHandle<unknown>[]>();
  for (const handle of handles) {
    for (const link of docsOf(handle) ?? []) {
      if (typeof link?.url !== "string") continue;
      const child = bare(link.url);
      parents.set(child, [...(parents.get(child) ?? []), handle]);
    }
  }
  const found = new Set<DocHandle<unknown>>();
  const queue = [bare(url)];
  while (queue.length) {
    for (const parent of parents.get(queue.shift()!) ?? []) {
      if (found.has(parent)) continue;
      found.add(parent);
      queue.push(bare(parent.url));
    }
  }
  return [...found];
}

/**
 * tell the folders holding where you are (`where()`: a {doc} or {call}, or
 * null for nowhere) that you're there, as `who()`, every PRESENCE_EVERY and
 * as soon as `update()` is called; folders it's no longer in are told bye.
 * `stop()` tells them all bye
 */
export function announce({
  repo,
  from,
  where,
  who,
  every = PRESENCE_EVERY,
}: {
  repo: () => Repo | null | undefined;
  from: string;
  where: () => Where | null;
  who: () => Who | null;
  every?: number;
}) {
  let told = new Map<string, DocHandle<unknown>>();
  const say = (handle: DocHandle<unknown>, message: object) => {
    try {
      handle.broadcast({ [PRESENCE]: "here", from, ...message });
    } catch {}
  };
  const bye = (handle: DocHandle<unknown>) => {
    try {
      handle.broadcast({ [PRESENCE]: "bye", from });
    } catch {}
  };

  function update() {
    const now = where();
    const me = who();
    const open = repo()?.handles;
    const url = now && ("doc" in now ? now.doc : now.call);
    const folders = url && me && open ? foldersHolding(Object.values(open), url) : [];
    const next = new Map(folders.map((handle) => [handle.url as string, handle]));
    for (const [url, handle] of told) if (!next.has(url)) bye(handle);
    for (const handle of next.values()) say(handle, { who: me, ...now });
    told = next;
  }

  const timer = setInterval(update, every);
  update();
  return {
    update,
    stop() {
      clearInterval(timer);
      for (const handle of told.values()) bye(handle);
      told = new Map();
    },
  };
}

/** who you are (the account's contact), as presence says it, or null till it's known */
export async function whoAmI(repo: Repo | null | undefined): Promise<Who | null> {
  const account = (globalThis as { accountDocHandle?: DocHandle<{ contactUrl?: string }> }).accountDocHandle;
  const contact = account?.doc()?.contactUrl;
  if (!contact || !repo) return null;
  try {
    const doc = (await repo.find<Record<string, unknown>>(contact as never)).doc();
    const registered = doc?.type === "registered";
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      contact,
      name: (registered && text(doc?.name)) || "anonymous",
      colour: text(doc?.color),
      avatar: (registered && text(doc?.avatarUrl)) || "",
    };
  } catch {
    return null;
  }
}
