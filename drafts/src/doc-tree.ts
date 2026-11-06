import type {
  AutomergeUrl,
  DocHandle,
  Repo,
} from "@automerge/automerge-repo/slim";
import {
  getRegistry,
  type Plugin,
  type PluginDescription,
} from "@inkandswitch/patchwork-plugins";

import { canonicalUrl } from "./clone-policy.js";

export const CHILDREN_PLUGIN_TYPE = "patchwork:children";

// A document that is part of another one: a folder's entries, a directory's
// files, an essay's embeds. `type` is the child's datatype when the link
// records it, so walkers can skip loading docs that can't have children.
export type ChildLink = { url: AutomergeUrl; type?: string };

// Registered by whichever package knows a datatype's shape. Returns only the
// docs that belong to the doc, never ones it merely references (authors,
// accounts, tools). `"*"` answers for every datatype.
export type ChildrenDescription = PluginDescription & {
  type: typeof CHILDREN_PLUGIN_TYPE;
  datatypes: string[];
};

export type ChildrenOf = (doc: unknown) => ChildLink[];

export type DocTree = {
  // root first, then depth-first in entry order
  urls: () => AutomergeUrl[];
  has: (url: AutomergeUrl) => boolean;
  // The doc `url` was first reached from; null for the root and strangers.
  parentOf: (url: AutomergeUrl) => AutomergeUrl | null;
  // Resolves once the first walk has finished.
  settled: () => Promise<void>;
  isSettled: () => boolean;
  refresh: () => void;
  dispose: () => void;
};

export type DocTreeOptions = {
  // The url to read `url`'s children through, e.g. a draft's clone of it.
  readUrl?: (url: AutomergeUrl) => AutomergeUrl;
  onChange?: () => void;
};

const REBUILD_DEBOUNCE_MS = 50;

// Every document under `root`, by asking each one's children plugins. The
// first path to a doc wins, so each appears once, and cycles end there. Docs
// that fail to load are leaves. Every doc read is watched, and any change (or
// a children plugin registering) walks again.
export function watchDocTree(
  repo: Repo,
  root: AutomergeUrl,
  options: DocTreeOptions = {}
): DocTree {
  const readUrl = options.readUrl ?? ((url) => url);
  let order: AutomergeUrl[] = [];
  let members = new Set<AutomergeUrl>();
  let parents = new Map<AutomergeUrl, AutomergeUrl>();
  const watched = new Map<AutomergeUrl, DocHandle<unknown>>();
  let disposed = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let building = false;
  let pending = false;
  let resolveSettled!: () => void;
  const settledPromise = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  const onWatchedChange = () => schedule();
  const offRegistry = childrenRegistry().on("changed", schedule);
  schedule();

  return {
    urls: () => order,
    has: (url) => members.has(canonicalUrl(url)),
    parentOf: (url) => parents.get(canonicalUrl(url)) ?? null,
    settled: () => settledPromise,
    isSettled: () => settled,
    refresh: schedule,
    dispose() {
      disposed = true;
      offRegistry();
      if (timer !== null) clearTimeout(timer);
      for (const handle of watched.values()) handle.off("change", onWatchedChange);
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
      const next = await walkDocTree(repo, canonicalUrl(root), readUrl);
      if (disposed) return;
      const changed = !sameList(order, next.urls);
      order = next.urls;
      members = new Set(next.urls);
      parents = next.parents;
      rewatch(next.read);
      settled = true;
      if (changed) options.onChange?.();
    } catch (err) {
      console.error("[drafts] document tree walk failed:", err);
    } finally {
      building = false;
      resolveSettled();
      if (pending) {
        pending = false;
        schedule();
      }
    }
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

// One walk of the tree under `root`. Children load in parallel; the order
// stays depth-first in entry order, so the first path is deterministic.
export async function walkDocTree(
  repo: Repo,
  root: AutomergeUrl,
  readUrl: (url: AutomergeUrl) => AutomergeUrl = (url) => url
): Promise<{
  urls: AutomergeUrl[];
  read: Map<AutomergeUrl, DocHandle<unknown>>;
  parents: Map<AutomergeUrl, AutomergeUrl>;
}> {
  const urls: AutomergeUrl[] = [];
  const read = new Map<AutomergeUrl, DocHandle<unknown>>();
  const parents = new Map<AutomergeUrl, AutomergeUrl>();
  const visited = new Set<AutomergeUrl>();
  const loads = new Map<AutomergeUrl, Promise<DocHandle<unknown> | null>>();

  const load = (url: AutomergeUrl) => {
    let promise = loads.get(url);
    if (!promise) {
      promise = repo.find<unknown>(readUrl(url)).then(
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

  const visit = async (url: AutomergeUrl): Promise<void> => {
    urls.push(url);
    const handle = await load(url);
    if (!handle) return;
    const children = (await childrenOf(handle.doc())).filter(
      (child) => !visited.has(child.url)
    );
    for (const child of children) {
      visited.add(child.url);
      parents.set(child.url, url);
      if (mayHaveChildren(child.type)) void load(child.url);
    }
    for (const child of children) {
      if (mayHaveChildren(child.type)) await visit(child.url);
      else urls.push(child.url);
    }
  };

  visited.add(root);
  await visit(root);
  return { urls, read, parents };
}

// The children of a materialized doc, from every children plugin for its
// datatype and every `"*"` one.
export async function childrenOf(doc: unknown): Promise<ChildLink[]> {
  const type = datatypeOf(doc);
  const registry = childrenRegistry();
  const plugins = registry.filter((plugin) => answersFor(plugin, type));
  const loaded = await registry.loadAll(plugins);
  const out: ChildLink[] = [];
  const seen = new Set<AutomergeUrl>();
  for (const plugin of loaded) {
    let links: ChildLink[];
    try {
      links = (plugin.module as ChildrenOf)(doc) ?? [];
    } catch (err) {
      console.warn(`[drafts] children plugin ${plugin.id} failed:`, err);
      continue;
    }
    for (const link of links) {
      const url = canonicalUrl(link.url);
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, type: link.type });
    }
  }
  return out;
}

// False only when a link's datatype is known and nothing answers for it.
export function mayHaveChildren(type: string | undefined): boolean {
  if (type === undefined) return true;
  return childrenRegistry().all().some((plugin) => answersFor(plugin, type));
}

function childrenRegistry() {
  return getRegistry<ChildrenDescription>(CHILDREN_PLUGIN_TYPE);
}

function answersFor(plugin: Plugin<ChildrenDescription>, type: string | undefined): boolean {
  const datatypes = Array.isArray(plugin.datatypes) ? plugin.datatypes : [];
  return datatypes.includes("*") || (type !== undefined && datatypes.includes(type));
}

function datatypeOf(doc: unknown): string | undefined {
  const type = (doc as { "@patchwork"?: { type?: unknown } } | undefined)?.[
    "@patchwork"
  ]?.type;
  return type === undefined || type === null ? undefined : String(type);
}

function sameList<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
