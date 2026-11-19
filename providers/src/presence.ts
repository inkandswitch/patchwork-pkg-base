import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";

/**
 * Presence beyond a doc: telling the folders a doc is in that you're there,
 * so a list of folders (the sideboard) can show who's where without loading
 * every doc in it.
 *
 * On every folder that holds the doc, as far as can be found from the
 * folders this tab has open (each searched all the way down, folders only,
 * never the docs in them), every few seconds, an ephemeral message:
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
// how often the folders holding where you are are looked for again (they change)
export const PRESENCE_LOOK = 30_000;
// no more folders than this are loaded looking
const MOST_FOLDERS = 2_000;

export type Who = { contact: string; name: string; colour: string; avatar: string };
export type Where = { doc: string } | { call: string };

/** a doc url without its heads or path: every version of a doc is the same doc */
export const bare = (url: string) => url.split(/[#/]/, 1)[0];

type Link = { url?: unknown; type?: unknown };
type FolderLike = { docs?: Link[] };
const docsOf = (handle: DocHandle<unknown>): Link[] | null => {
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
 * every folder under `roots` (handles), all the way down, loading the
 * folders (only: links of type "folder") it hasn't got, a level at a time,
 * each once however many link to it, no more than `most`
 */
export async function folderTree(
  repo: Pick<Repo, "find">,
  roots: DocHandle<unknown>[],
  most = MOST_FOLDERS,
): Promise<DocHandle<unknown>[]> {
  const seen = new Map<string, DocHandle<unknown>>();
  let level = roots;
  while (level.length && seen.size < most) {
    const next: Promise<DocHandle<unknown> | null>[] = [];
    for (const handle of level) {
      const url = bare(handle.url);
      if (seen.has(url) || seen.size >= most) continue;
      seen.set(url, handle);
      for (const link of docsOf(handle) ?? []) {
        if (link?.type !== "folder" || typeof link.url !== "string" || seen.has(bare(link.url))) continue;
        next.push(Promise.resolve(repo.find(link.url as never)).catch(() => null) as Promise<DocHandle<unknown> | null>);
      }
    }
    level = (await Promise.all(next)).filter((handle): handle is DocHandle<unknown> => !!handle);
  }
  return [...seen.values()];
}

/**
 * tell the folders holding where you are (`where()`: a {doc} or {call}, or
 * null for nowhere) that you're there, as `who()`, every PRESENCE_EVERY and
 * as soon as `update()` is called; folders it's no longer in are told bye.
 * which folders those are is looked for (folderTree, from every folder open
 * in the repo) as where you are changes, and every PRESENCE_LOOK. `stop()`
 * tells them all bye
 */
export function announce({
  repo,
  from,
  where,
  who,
  every = PRESENCE_EVERY,
  look = PRESENCE_LOOK,
}: {
  repo: () => Repo | null | undefined;
  from: string;
  where: () => Where | null;
  who: () => Who | null;
  every?: number;
  look?: number;
}) {
  let told = new Map<string, DocHandle<unknown>>();
  // the folders found holding `foundFor` (a bare url), and which look's latest
  let folders: DocHandle<unknown>[] = [];
  let foundFor: string | null = null;
  let looking = 0;
  const target = () => {
    const now = where();
    return now ? bare("doc" in now ? now.doc : now.call) : null;
  };
  async function find(url: string) {
    const r = repo();
    if (!r) return;
    const mine = ++looking;
    const roots = Object.values(r.handles).filter((handle) => docsOf(handle) !== null);
    const tree = await folderTree(r, roots);
    if (mine !== looking) return;
    folders = foldersHolding(tree, url);
    foundFor = url;
    tell();
  }
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

  // tell the folders found for where you are now (none, till they're found)
  function tell() {
    const now = where();
    const me = who();
    const url = target();
    const holding = url && me && foundFor === url ? folders : [];
    const next = new Map(holding.map((handle) => [handle.url as string, handle]));
    for (const [url, handle] of told) if (!next.has(url)) bye(handle);
    for (const handle of next.values()) say(handle, { who: me, ...now });
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
