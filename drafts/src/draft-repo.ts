import {
  encodeHeads,
  interpretAsDocumentId,
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AnyDocumentId,
  type AutomergeUrl,
  type DocHandle,
  type DocumentId,
  type DocumentProgress,
  type QueryState,
  type Repo,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";

import type { CloneEntry, DraftCheckpoint, DraftDoc } from "./draft-types.js";
import { canonicalUrl } from "./clone-policy.js";
import { cloneAt } from "./draft-clones.js";
import { watchDocTree, type DocTree } from "./doc-tree.js";
import { DraftHandle, forwardingProxy } from "./draft-handle.js";

/** What a `DraftRepo` resolves against. A null `draft` is main. */
export type DraftCheckout = {
  draft: DocHandle<DraftDoc> | null;
  at: DraftCheckpoint | null;
};

// The members a draft repo changes. Everything else (clone, delete, flush,
// the event emitter, ...) forwards to the base repo.
const OWNED: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  "base",
  "handles",
  "find",
  "findWithProgress",
  "create",
  "create2",
  "checkout",
  "setRoot",
  "dispose",
]);

type Entry = {
  presented: AutomergeUrl;
  root: AutomergeUrl;
  segments: unknown[];
  heads: UrlHeads | undefined;
  handle: DraftHandle<unknown>;
  // The backing url currently applied, and a counter so only the latest
  // re-point of an entry commits.
  applied: AutomergeUrl;
  seq: number;
};

/**
 * The repo a drafts overlay hands its subtree. `find` returns handles that
 * keep the url they were asked for but read and write the checked-out draft:
 *
 * - On main, the original doc.
 * - On a draft, the draft's clone of the doc once it has one; before that,
 *   the version the fork recorded (see `CloneEntry`), or the live original
 *   for docs the fork didn't know about.
 * - With a checkpoint, the same doc pinned to that checkpoint's `to` heads.
 *
 * The first write to a doc on a draft clones it at the version the draft
 * reads and records the clone in `DraftDoc.clones`, so a draft only owns the
 * docs it changed. Only docs that belong to the draft fork: ones it already
 * has an entry for, and ones in the tree under its root (`setRoot`). Writes
 * to anything else (accounts, contacts, ...) land on the doc itself. With no
 * root every doc forks.
 *
 * `checkout` re-points every live handle in place, so switching drafts or
 * scrubbing history remounts nothing.
 */
export class DraftRepo {
  readonly base: Repo;
  #checkout: DraftCheckout = { draft: null, at: null };
  readonly #entries = new Map<AutomergeUrl, Entry>();
  readonly #resolving = new Map<AutomergeUrl, Promise<DocHandle<unknown>>>();
  #root: AutomergeUrl | null = null;
  #tree: DocTree | null = null;
  // Docs created while a draft was checked out, by draft: they're the
  // draft's own, so they become its clone instead of being cloned.
  readonly #created = new Map<AutomergeUrl, AutomergeUrl>();
  #disposed = false;

  constructor(base: Repo) {
    this.base = base;
    return forwardingProxy<DraftRepo>(this, base, OWNED);
  }

  get handles(): Record<DocumentId, DocHandle<unknown>> {
    const out = { ...this.base.handles };
    for (const entry of this.#entries.values()) {
      if (entry.segments.length || entry.heads) continue;
      out[entry.handle.documentId] = entry.handle as unknown as DocHandle<unknown>;
    }
    return out;
  }

  find<T>(id: AnyDocumentId): Promise<DocHandle<T>> {
    const presented = presentedUrlOf(id);
    const pending = this.#resolving.get(presented);
    if (pending) return pending as Promise<DocHandle<T>>;
    const promise = this.#open(presented);
    // A failed find is usually a doc that hasn't synced yet; let the next
    // find try again rather than pinning it to this rejection.
    promise.catch(() => {
      if (this.#resolving.get(presented) === promise) {
        this.#resolving.delete(presented);
      }
    });
    this.#resolving.set(presented, promise);
    return promise as Promise<DocHandle<T>>;
  }

  findWithProgress<T>(id: AnyDocumentId): DocumentProgress<T> {
    const promise = this.find<T>(id);
    let state: QueryState<T> = { state: "loading", sources: {} };
    const callbacks = new Set<(state: QueryState<T>) => void>();
    const settle = (next: QueryState<T>) => {
      state = next;
      for (const callback of [...callbacks]) callback(state);
    };
    promise.then(
      (handle) => settle({ state: "ready", handle, sources: {} }),
      (error: Error) => settle({ state: "failed", error, sources: {} })
    );
    return {
      documentId: parseAutomergeUrl(presentedUrlOf(id)).documentId,
      peek: () => state,
      subscribe(callback) {
        callbacks.add(callback);
        return () => callbacks.delete(callback);
      },
      whenReady: () => promise,
      get state() {
        return state.state;
      },
      get progress() {
        return undefined;
      },
      get error() {
        return state.state === "failed" ? state.error : undefined;
      },
    } as DocumentProgress<T>;
  }

  create<T>(initialValue?: T): DocHandle<T> {
    const handle = this.base.create<T>(initialValue);
    this.#noteCreated(handle.url);
    return handle;
  }

  async create2<T>(initialValue?: T): Promise<DocHandle<T>> {
    const handle = await this.base.create2<T>(initialValue);
    this.#noteCreated(handle.url);
    return handle;
  }

  /** Re-point every live handle at `next`. */
  checkout(next: DraftCheckout): void {
    if (this.#disposed) return;
    const previous = this.#checkout.draft;
    this.#checkout = next;
    if (previous !== next.draft) {
      previous?.off("change", this.#onDraftChange);
      next.draft?.on("change", this.#onDraftChange);
    }
    this.#repointAll();
    this.#tree?.refresh();
  }

  /** The doc whose tree makes up a draft. */
  setRoot(root: AutomergeUrl | null): void {
    if (this.#disposed) return;
    const next = root ? canonicalUrl(root) : null;
    if (next === this.#root) return;
    this.#root = next;
    this.#tree?.dispose();
    this.#tree = next
      ? watchDocTree(this.base, next, {
          readUrl: (url) => this.#backingUrl(url, [], undefined),
        })
      : null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#tree?.dispose();
    this.#tree = null;
    this.#checkout.draft?.off("change", this.#onDraftChange);
    for (const entry of this.#entries.values()) entry.handle.dispose();
    this.#entries.clear();
    this.#resolving.clear();
  }

  // Someone else may have cloned a doc into this draft, or a fork may have
  // pre-populated its clones.
  #onDraftChange = () => {
    this.#repointAll();
    this.#tree?.refresh();
  };

  #noteCreated(url: AutomergeUrl): void {
    const draft = this.#checkout.draft;
    if (draft) this.#created.set(canonicalUrl(url), draft.url);
  }

  async #open(presented: AutomergeUrl): Promise<DocHandle<unknown>> {
    const { documentId, segments, heads } = parseAutomergeUrl(presented);
    const root = stringifyAutomergeUrl({ documentId });
    const applied = this.#backingUrl(root, segments ?? [], heads);
    const backing = await this.base.find<unknown>(applied);
    if (this.#disposed) throw new Error(`[drafts] repo disposed: ${presented}`);

    const handle = new DraftHandle<unknown>({
      presentedUrl: presented,
      backing,
      beforeWrite: heads ? undefined : () => this.#cloneOnWrite(root),
    });
    const entry: Entry = {
      presented,
      root,
      segments: segments ?? [],
      heads,
      handle,
      applied,
      seq: 0,
    };
    this.#entries.set(presented, entry);
    // The checkout may have moved while the backing loaded.
    void this.#repoint(entry);
    return handle as unknown as DocHandle<unknown>;
  }

  #backingUrl(
    root: AutomergeUrl,
    segments: unknown[],
    heads: UrlHeads | undefined
  ): AutomergeUrl {
    const entry = this.#checkout.draft?.doc()?.clones?.[root];
    const pinned = heads ?? this.#checkout.at?.[root]?.to ?? undefined;
    const read = entry?.cloneUrl ?? entry?.source ?? root;
    return stringifyAutomergeUrl({
      documentId: parseAutomergeUrl(read).documentId,
      segments: segments.length ? (segments as never) : undefined,
      heads: pinned ?? (entry && !entry.cloneUrl ? entry.clonedAt : undefined),
    });
  }

  #repointAll(): void {
    for (const entry of this.#entries.values()) void this.#repoint(entry);
  }

  async #repoint(entry: Entry): Promise<void> {
    const target = this.#backingUrl(entry.root, entry.segments, entry.heads);
    if (target === entry.applied) return;
    const seq = ++entry.seq;
    try {
      const backing = await this.base.find<unknown>(target);
      if (seq !== entry.seq || this.#disposed) return;
      entry.applied = target;
      entry.handle.swapBackingDocHandle(backing);
    } catch (err) {
      console.error(`[drafts] failed to re-point ${entry.presented}:`, err);
    }
  }

  // Runs synchronously inside the write, so the write itself lands on the
  // clone. The clone is made at the version the handles were reading, so
  // they move onto it quietly.
  #cloneOnWrite(root: AutomergeUrl): void {
    const draft = this.#checkout.draft;
    if (!draft || this.#checkout.at?.[root]?.to) return;

    const recorded = draft.doc()?.clones?.[root];
    if (recorded?.cloneUrl) {
      // Recorded but not re-pointed yet: move now if the clone is loaded, so
      // the write can't land on the original.
      const clone = this.#loaded(recorded.cloneUrl);
      if (clone) this.#moveOnto(root, clone, { sameContent: false });
      return;
    }
    if (!recorded && !this.#belongs(root)) return;

    if (!recorded && this.#created.get(root) === draft.url) {
      draft.change((d) => {
        d.clones[root] = { cloneUrl: root, clonedAt: encodeHeads([]) };
      });
      return;
    }

    const clone = this.#forkFor(root, recorded);
    if (!clone) return;
    this.#moveOnto(root, clone.handle, { sameContent: true });
    const cloneUrl = canonicalUrl(clone.handle.url);
    draft.change((d) => {
      const entry = d.clones[root];
      if (entry) entry.cloneUrl = cloneUrl;
      else d.clones[root] = { cloneUrl, clonedAt: clone.clonedAt };
    });
  }

  // A clone of `root` at the version the draft reads it: the recorded fork
  // point, or the original as it is now.
  #forkFor(
    root: AutomergeUrl,
    recorded: CloneEntry | undefined
  ): { handle: DocHandle<unknown>; clonedAt: UrlHeads } | null {
    const source = this.#loaded(recorded?.source ?? root);
    if (!source) return null;
    const clonedAt = recorded?.clonedAt ?? source.heads();
    try {
      return { handle: cloneAt(this.base, source, clonedAt), clonedAt };
    } catch (err) {
      console.error(`[drafts] failed to fork ${root}:`, err);
      return null;
    }
  }

  // Unknown while the tree is still being walked; erring on forking is safe.
  #belongs(root: AutomergeUrl): boolean {
    const tree = this.#tree;
    return !tree || !tree.isSettled() || tree.has(root);
  }

  #loaded(url: AutomergeUrl): DocHandle<unknown> | null {
    const handle = this.base.handles[parseAutomergeUrl(url).documentId];
    return handle?.isReady() ? handle : null;
  }

  #moveOnto(
    root: AutomergeUrl,
    clone: DocHandle<unknown>,
    { sameContent }: { sameContent: boolean }
  ): void {
    for (const entry of this.#entries.values()) {
      if (entry.root !== root || entry.heads) continue;
      const applied = stringifyAutomergeUrl({
        documentId: clone.documentId,
        segments: entry.segments.length ? (entry.segments as never) : undefined,
      });
      if (applied === entry.applied) continue;
      entry.seq++;
      entry.applied = applied;
      const backing = entry.segments.length
        ? (clone as unknown as { sub: (...s: unknown[]) => DocHandle<unknown> })
            .sub(...entry.segments)
        : clone;
      entry.handle.swapBackingDocHandle(backing, { sameContent });
    }
  }
}

/**
 * The repo beneath any drafts overlay. The drafts machinery itself (draft
 * docs, timelines, merges) reads originals and clones as they are, so it
 * must never resolve through a `DraftRepo`, even from inside one.
 */
export function baseRepo(repo: Repo): Repo {
  return repo instanceof DraftRepo ? baseRepo(repo.base) : repo;
}

// A url's identity through the overlay: document, path and heads.
function presentedUrlOf(id: AnyDocumentId): AutomergeUrl {
  if (isValidAutomergeUrl(id)) {
    const { documentId, segments, heads } = parseAutomergeUrl(id);
    return stringifyAutomergeUrl({ documentId, segments, heads });
  }
  return stringifyAutomergeUrl({ documentId: interpretAsDocumentId(id) });
}
