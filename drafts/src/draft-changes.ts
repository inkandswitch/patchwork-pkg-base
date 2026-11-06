import * as Automerge from "@automerge/automerge/slim";
import {
  decodeHeads,
  isImmutableString,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";

import type {
  DocChange,
  DraftChanges,
  DraftCheckpoint,
  DraftDoc,
  RemovedEntry,
} from "./draft-types.js";
import { canonicalUrl } from "./clone-policy.js";
import { watchDocTree, type DocTree } from "./doc-tree.js";

const RECOMPUTE_DEBOUNCE_MS = 100;

export const NO_CHANGES: DraftChanges = {
  changed: {},
  removed: {},
  containing: [],
};

export type ChangesInput = {
  draft: DocHandle<DraftDoc> | null;
  at: DraftCheckpoint | null;
};

export type DraftChangesWatcher = {
  current: () => DraftChanges;
  update: (input: ChangesInput) => void;
  dispose: () => void;
};

// What changed under `root` per the checkpoint's baselines (see
// `DraftChanges`), recomputed as the checkpoint moves and as live docs are
// edited. Nothing is read while no doc has a baseline (the eye is closed).
//
// `repo` is the base repo, where the draft's clones are read with their full
// history; `view` is the overlay's repo, whose tree is the version shown.
export function watchDraftChanges(options: {
  repo: Repo;
  view: Repo;
  root: AutomergeUrl;
  onChange: (changes: DraftChanges) => void;
}): DraftChangesWatcher {
  const { repo, view, root } = options;
  let input: ChangesInput = { draft: null, at: null };
  let changes = NO_CHANGES;
  let sent = JSON.stringify(NO_CHANGES);
  let tree: DocTree | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;
  let disposed = false;
  const live = new Map<AutomergeUrl, DocHandle<unknown>>();

  return {
    current: () => changes,
    update(next) {
      input = next;
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      tree?.dispose();
      unwatchLive();
    },
  };

  function schedule(): void {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void recompute();
    }, RECOMPUTE_DEBOUNCE_MS);
  }

  async function recompute(): Promise<void> {
    const mine = ++seq;
    const baselines = baselinesOf(input.at);
    if (baselines.length === 0) {
      tree?.dispose();
      tree = null;
      unwatchLive();
      publish(NO_CHANGES);
      return;
    }
    tree ??= watchDocTree(view, root, { onChange: schedule });
    const next = await compare(baselines, input.draft);
    if (disposed || mine !== seq) return;
    await tree.settled();
    if (disposed || mine !== seq) return;
    next.containing = containing(next, tree);
    publish(next);
  }

  async function compare(
    baselines: Baseline[],
    draft: DocHandle<DraftDoc> | null
  ): Promise<DraftChanges> {
    const changed: Record<AutomergeUrl, DocChange> = {};
    const removed: Record<AutomergeUrl, RemovedEntry[]> = {};
    const clones = draft?.doc()?.clones;
    const watching = new Map<AutomergeUrl, DocHandle<unknown>>();

    for (const { url, from, to } of baselines) {
      const entry = clones?.[url];
      const backing = entry?.cloneUrl ?? entry?.source ?? url;
      const handle = await repo.find<unknown>(backing).catch(() => null);
      if (!handle) continue;
      if (!to) watching.set(url, handle);
      const doc = handle.doc() as Automerge.Doc<unknown>;
      const fromHeads = decodeHeads(from);
      const toHeads = to ? decodeHeads(to) : Automerge.getHeads(doc);
      let before: unknown;
      let after: unknown;
      try {
        before = fromHeads.length ? Automerge.view(doc, fromHeads) : undefined;
        after = to ? Automerge.view(doc, toHeads) : doc;
      } catch (err) {
        console.warn(`[drafts] can't compare ${url} with its baseline:`, err);
        continue;
      }

      if (!before) changed[url] = "added";
      else if (contentChanged(doc, fromHeads, toHeads)) changed[url] ??= "modified";

      const now = entriesOf(after);
      if (!now) continue;
      const was = entriesOf(before) ?? [];
      const nowUrls = new Set(now.map((e) => e.url));
      const wasUrls = new Set(was.map((e) => e.url));
      for (const e of now) if (!wasUrls.has(e.url)) changed[e.url] = "added";

      const gone: RemovedEntry[] = [];
      let kept: AutomergeUrl | null = null;
      for (const e of was) {
        if (nowUrls.has(e.url)) {
          kept = e.url;
          continue;
        }
        gone.push({
          url: await pinnedNow(e.url),
          name: e.name,
          type: e.type,
          folder: stringifyAutomergeUrl({
            documentId: parseAutomergeUrl(url).documentId,
            heads: from,
          }),
          after: kept,
        });
      }
      if (gone.length) removed[url] = gone;
    }

    rewatchLive(watching);
    return { changed, removed, containing: [] };
  }

  // The doc as the overlay shows it now, pinned, so it opens read-only.
  async function pinnedNow(url: AutomergeUrl): Promise<AutomergeUrl> {
    try {
      const handle = await view.find<unknown>(url);
      return stringifyAutomergeUrl({
        documentId: parseAutomergeUrl(url).documentId,
        heads: handle.heads(),
      });
    } catch {
      return url;
    }
  }

  function containing(changes: DraftChanges, tree: DocTree): AutomergeUrl[] {
    const out = new Set<AutomergeUrl>();
    const starts = [
      ...Object.keys(changes.changed),
      ...Object.keys(changes.removed),
    ] as AutomergeUrl[];
    for (const url of starts) {
      for (let p = tree.parentOf(url); p && !out.has(p); p = tree.parentOf(p)) {
        out.add(p);
      }
    }
    return [...out];
  }

  function rewatchLive(next: Map<AutomergeUrl, DocHandle<unknown>>): void {
    for (const [url, handle] of live) {
      if (next.get(url) === handle) continue;
      handle.off("change", schedule);
      live.delete(url);
    }
    for (const [url, handle] of next) {
      if (live.has(url)) continue;
      handle.on("change", schedule);
      live.set(url, handle);
    }
  }

  function unwatchLive(): void {
    for (const handle of live.values()) handle.off("change", schedule);
    live.clear();
  }

  function publish(next: DraftChanges): void {
    changes = next;
    const json = JSON.stringify(next);
    if (json === sent) return;
    sent = json;
    options.onChange(next);
  }
}

type Baseline = {
  url: AutomergeUrl;
  from: NonNullable<DraftCheckpoint[AutomergeUrl]["from"]>;
  to: DraftCheckpoint[AutomergeUrl]["to"];
};

function baselinesOf(at: DraftCheckpoint | null): Baseline[] {
  const out: Baseline[] = [];
  for (const [url, entry] of Object.entries(at ?? {})) {
    if (entry.from === undefined) continue;
    out.push({ url: canonicalUrl(url as AutomergeUrl), from: entry.from, to: entry.to });
  }
  return out;
}

function contentChanged(
  doc: Automerge.Doc<unknown>,
  from: Automerge.Heads,
  to: Automerge.Heads
): boolean {
  try {
    return Automerge.diff(doc, from, to).some((p) => p.path[0] !== "@patchwork");
  } catch {
    return false;
  }
}

type Entry = { url: AutomergeUrl; name: string; type: string };

// A folder's entries, or null for anything that isn't one.
function entriesOf(doc: unknown): Entry[] | null {
  const docs = (doc as { docs?: unknown } | undefined)?.docs;
  if (!Array.isArray(docs)) return null;
  const out: Entry[] = [];
  for (const link of docs) {
    const url = text(link?.url);
    if (!url) continue;
    try {
      out.push({
        url: canonicalUrl(url as AutomergeUrl),
        name: text(link.name) ?? "",
        type: text(link.type) ?? "",
      });
    } catch {
      // not an automerge url
    }
  }
  return out;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isImmutableString(value)) return String(value);
  return undefined;
}
