import type {
  AutomergeUrl,
  DocHandle,
  Repo,
} from "@automerge/automerge-repo/slim";

import type { HasDrafts } from "./draft-types.js";
import { canonicalUrl } from "./clone-policy.js";
import { childrenOf, mayHaveChildren } from "./doc-tree.js";
import { isContainerType, isWorkspaceFolder } from "./folder-links.js";

export type WorkspaceIndexOptions = {
  rootFolderUrl: () => AutomergeUrl | undefined;
  // The url to read `url` through while inside workspace `root`: its clone in
  // the root's checked-out draft, or `url` itself on main.
  readUrlFor: (root: AutomergeUrl, url: AutomergeUrl) => Promise<AutomergeUrl>;
  onChange: () => void;
};

export type WorkspaceIndex = {
  // The workspace folder `url` belongs to, if any.
  rootOf: (url: AutomergeUrl) => AutomergeUrl | undefined;
  // Whether `url` is a container in the tree that isn't inside a workspace.
  isPlainContainer: (url: AutomergeUrl) => boolean;
  // Resolves once the first walk has finished.
  settled: () => Promise<void>;
  refresh: () => void;
  dispose: () => void;
};

const REBUILD_DEBOUNCE_MS = 50;

// Which workspace folder each doc in the account's folder tree belongs to.
//
// Walks depth-first from the root folder in entry order. A doc's path is the
// first place the walk reaches it — later links to the same doc are ignored,
// so every doc has exactly one answer — and its workspace is the topmost
// workspace folder on that path. Below a workspace folder, containers are
// read through the workspace's checked-out draft, so entries added, moved or
// removed on the draft are indexed where the draft has them.
//
// Outside workspaces only folders are loaded; inside one, every doc whose
// children plugins could list more (folders, essays with embeds). Leaves are
// classified from the link alone. Every doc read is watched, and any change
// rebuilds the index.
export function createWorkspaceIndex(
  repo: Repo,
  options: WorkspaceIndexOptions
): WorkspaceIndex {
  let roots = new Map<AutomergeUrl, AutomergeUrl>();
  let plainContainers = new Set<AutomergeUrl>();
  const watched = new Map<AutomergeUrl, DocHandle<unknown>>();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let building = false;
  let pending = false;
  let resolveSettled!: () => void;
  const settledPromise = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  const onWatchedChange = () => schedule();

  return {
    rootOf: (url) => roots.get(url),
    isPlainContainer: (url) => plainContainers.has(url),
    settled: () => settledPromise,
    refresh: schedule,
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      for (const handle of watched.values()) {
        handle.off("change", onWatchedChange);
      }
      watched.clear();
      resolveSettled();
    },
  };

  function schedule(): void {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void rebuild();
    }, REBUILD_DEBOUNCE_MS);
  }

  async function rebuild(): Promise<void> {
    if (disposed) return;
    if (building) {
      pending = true;
      return;
    }
    building = true;
    try {
      const next = await walk();
      if (disposed) return;
      const changed =
        !sameMap(roots, next.roots) ||
        !sameSet(plainContainers, next.plainContainers);
      roots = next.roots;
      plainContainers = next.plainContainers;
      rewatch(next.read);
      if (changed) options.onChange();
    } catch (err) {
      console.error("[drafts] workspace index rebuild failed:", err);
    } finally {
      building = false;
      resolveSettled();
      if (pending) {
        pending = false;
        schedule();
      }
    }
  }

  async function walk(): Promise<{
    roots: Map<AutomergeUrl, AutomergeUrl>;
    plainContainers: Set<AutomergeUrl>;
    read: Map<AutomergeUrl, DocHandle<unknown>>;
  }> {
    const nextRoots = new Map<AutomergeUrl, AutomergeUrl>();
    const nextPlain = new Set<AutomergeUrl>();
    const read = new Map<AutomergeUrl, DocHandle<unknown>>();
    const visited = new Set<AutomergeUrl>();
    const loads = new Map<AutomergeUrl, Promise<DocHandle<unknown> | null>>();

    const load = (url: AutomergeUrl) => {
      let promise = loads.get(url);
      if (!promise) {
        promise = repo.find<unknown>(url).then(
          (handle) => {
            read.set(url, handle);
            return handle;
          },
          () => null
        );
        loads.set(url, promise);
      }
      return promise;
    };

    const visitContainer = async (
      url: AutomergeUrl,
      root: AutomergeUrl | null
    ): Promise<void> => {
      const original = await load(url);
      if (!original || disposed) return;
      let inner = root;
      if (!inner && isWorkspaceFolder(original.doc() as HasDrafts)) inner = url;
      if (inner) nextRoots.set(url, inner);
      else nextPlain.add(url);

      let content = original;
      if (inner) {
        const readUrl = await options.readUrlFor(inner, url);
        if (readUrl !== url) content = (await load(readUrl)) ?? original;
      }

      const children = await childrenOf(content.doc());
      // Outside a workspace only containers can lead into one; inside, every
      // doc with children belongs to it.
      const descend = (type: string | undefined) =>
        inner ? mayHaveChildren(type) : type === undefined || isContainerType(type);
      const containers = children.filter(
        (c) => descend(c.type) && !visited.has(c.url)
      );
      // Start every child container loading at once; the walk itself stays
      // in entry order so the first path is deterministic.
      for (const child of containers) void load(child.url);
      for (const child of children) {
        if (visited.has(child.url)) continue;
        visited.add(child.url);
        if (descend(child.type)) {
          await visitContainer(child.url, inner);
        } else if (inner) {
          nextRoots.set(child.url, inner);
        }
      }
    };

    const start = options.rootFolderUrl();
    if (start) {
      const url = canonicalUrl(start);
      visited.add(url);
      await visitContainer(url, null);
    }
    return { roots: nextRoots, plainContainers: nextPlain, read };
  }

  function rewatch(read: Map<AutomergeUrl, DocHandle<unknown>>): void {
    for (const [url, handle] of watched) {
      if (read.get(url) === handle) continue;
      handle.off("change", onWatchedChange);
      watched.delete(url);
    }
    for (const [url, handle] of read) {
      if (watched.has(url)) continue;
      handle.on("change", onWatchedChange);
      watched.set(url, handle);
    }
  }
}

function sameMap<K, V>(a: Map<K, V>, b: Map<K, V>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
