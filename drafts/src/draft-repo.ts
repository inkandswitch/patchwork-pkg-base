import {
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

import type { DraftCheckpoint, DraftDoc } from "./draft-types.js";
import { canonicalUrl } from "./clone-policy.js";
import { isSkippedDoc } from "./draft-clones.js";
import { DraftHandle, forwardingProxy } from "./draft-handle.js";

/** What a `DraftRepo` resolves against. A null `draft` is main. */
export type DraftCheckout = {
  draft: DocHandle<DraftDoc> | null;
  at: DraftCheckpoint | null;
};

// The members a draft repo changes. Everything else (create, clone, delete,
// flush, the event emitter, ...) forwards to the base repo: a doc created
// on a draft isn't anyone else's, so it needs no clone.
const OWNED: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  "base",
  "handles",
  "find",
  "findWithProgress",
  "checkout",
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
 * - On a draft, the draft's clone of the doc once it has one, else the
 *   original. The first write to a doc on a draft forks it and records the
 *   clone in `DraftDoc.clones`, so a draft only owns the docs it changed.
 * - With a checkpoint, the same doc pinned to that checkpoint's `to` heads.
 * - Docs that are never drafted (accounts, contacts; see `SKIPPED_DATATYPES`)
 *   come straight from the base repo.
 *
 * `checkout` re-points every live handle in place, so switching drafts or
 * scrubbing history remounts nothing.
 */
export class DraftRepo {
  readonly base: Repo;
  #checkout: DraftCheckout = { draft: null, at: null };
  readonly #entries = new Map<AutomergeUrl, Entry>();
  readonly #resolving = new Map<AutomergeUrl, Promise<DocHandle<unknown>>>();
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
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#checkout.draft?.off("change", this.#onDraftChange);
    for (const entry of this.#entries.values()) entry.handle.dispose();
    this.#entries.clear();
    this.#resolving.clear();
  }

  // Someone else may have cloned a doc into this draft, or a fork may have
  // pre-populated its clones.
  #onDraftChange = () => this.#repointAll();

  async #open(presented: AutomergeUrl): Promise<DocHandle<unknown>> {
    const { documentId, segments, heads } = parseAutomergeUrl(presented);
    const root = stringifyAutomergeUrl({ documentId });
    if (await isSkippedDoc(this.base, root)) return this.base.find(presented);

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
    const clone = this.#checkout.draft?.doc()?.clones?.[root]?.cloneUrl;
    const documentId = parseAutomergeUrl(clone ?? root).documentId;
    return stringifyAutomergeUrl({
      documentId,
      segments: segments.length ? (segments as never) : undefined,
      heads: heads ?? this.#checkout.at?.[root]?.to ?? undefined,
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
  // clone. The clone shares the original's history, so the handles moving
  // onto it see the same document and are swapped quietly.
  #cloneOnWrite(root: AutomergeUrl): void {
    const draft = this.#checkout.draft;
    if (!draft || this.#checkout.at?.[root]?.to) return;

    const recorded = draft.doc()?.clones?.[root];
    if (recorded) {
      // Recorded but not re-pointed yet: move now if the clone is loaded, so
      // the write can't land on the original.
      const clone = this.base.handles[parseAutomergeUrl(recorded.cloneUrl).documentId];
      if (clone?.isReady()) this.#moveOnto(root, clone, { sameContent: false });
      return;
    }

    const original = this.base.handles[parseAutomergeUrl(root).documentId];
    if (!original?.isReady()) return;
    const clonedAt = original.heads();
    const clone = this.base.clone(original);
    this.#moveOnto(root, clone, { sameContent: true });
    draft.change((d) => {
      d.clones[root] = { cloneUrl: canonicalUrl(clone.url), clonedAt };
    });
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
