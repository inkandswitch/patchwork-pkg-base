import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type DocumentId,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";

type Listener = (...args: unknown[]) => void;

// The members a draft handle changes. Everything else (doc, heads, view,
// diff, ...) forwards to whichever handle currently backs it.
const OWNED: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  "url",
  "documentId",
  "backingHandle",
  "swapBackingDocHandle",
  "change",
  "changeAt",
  "sub",
  "merge",
  "overlaps",
  "contains",
  "isChildOf",
  "equals",
  "on",
  "off",
  "once",
  "addListener",
  "removeListener",
  "removeAllListeners",
  "emit",
  "dispose",
]);

export type DraftHandleOpts<T> = {
  presentedUrl: AutomergeUrl;
  backing: DocHandle<T>;
  // Runs before every write, and may swap the backing (to a fresh clone) so
  // the write lands there.
  beforeWrite?: () => void;
};

type SubEntry = {
  wrapped: DraftHandle<unknown>;
  segments: unknown[];
};

/**
 * A `DocHandle` that keeps reporting the url it was asked for while reading
 * and writing whichever handle backs it: the original on main, the draft's
 * clone on a draft, either pinned to a checkpoint's heads. Events from the
 * backing are re-emitted with `handle` stamped to this wrapper, and sub-handles
 * stay in the presented url space, so nothing downstream sees a clone's url.
 *
 * `swapBackingDocHandle` re-points a live handle. Unless it is told the new
 * backing holds the same document, it emits a `change` with
 * `scopeReplaced: true`: no patch stream connects two forks, so consumers
 * have to re-read `doc()`.
 */
export class DraftHandle<T> {
  readonly #presentedUrl: AutomergeUrl;
  #handle: DocHandle<T>;
  readonly #beforeWrite: (() => void) | undefined;
  readonly #listeners = new Map<string, Set<Listener>>();
  readonly #forwarders = new Map<string, Listener>();
  readonly #subs = new Map<AutomergeUrl, SubEntry>();
  #self: DraftHandle<T>;

  constructor(opts: DraftHandleOpts<T>) {
    this.#presentedUrl = opts.presentedUrl;
    this.#handle = opts.backing;
    this.#beforeWrite = opts.beforeWrite;
    this.#self = forwardingProxy<DraftHandle<T>>(
      this,
      () => this.#handle,
      OWNED
    );
    return this.#self;
  }

  get url(): AutomergeUrl {
    return this.#presentedUrl;
  }

  get documentId(): DocumentId {
    return parseAutomergeUrl(this.#presentedUrl).documentId;
  }

  get backingHandle(): DocHandle<T> {
    return this.#handle;
  }

  swapBackingDocHandle(
    next: DocHandle<T>,
    { sameContent = false }: { sameContent?: boolean } = {}
  ): void {
    const previous = this.#handle;
    if (next === previous) return;
    const before = previous.doc();
    this.#handle = next;

    for (const [ev, forwarder] of this.#forwarders) {
      emitter(previous).off(ev, forwarder);
      emitter(next).on(ev, forwarder);
    }
    for (const entry of this.#subs.values()) {
      entry.wrapped.swapBackingDocHandle(subOf(next, entry.segments), {
        sameContent,
      });
    }
    if (sameContent) return;

    const after = next.doc();
    this.emit("change", {
      handle: this.#self,
      doc: after,
      patches: [],
      scopeReplaced: true,
      patchInfo: { before, after, source: "change" },
    });
  }

  change(...args: Parameters<DocHandle<T>["change"]>): void {
    this.#beforeWrite?.();
    this.#handle.change(...args);
  }

  changeAt(...args: Parameters<DocHandle<T>["changeAt"]>): UrlHeads | undefined {
    this.#beforeWrite?.();
    return this.#handle.changeAt(...args);
  }

  // Comparisons and merges read the other handle's internals, which a wrapper
  // doesn't have, so unwrap it first.
  merge(other: DocHandle<T>): void {
    this.#beforeWrite?.();
    this.#handle.merge(unwrap(other));
  }

  overlaps(other: DocHandle<unknown>): boolean {
    return this.#handle.overlaps(unwrap(other));
  }

  contains(other: DocHandle<unknown>): boolean {
    return this.#handle.contains(unwrap(other));
  }

  isChildOf(other: DocHandle<unknown>): boolean {
    return this.#handle.isChildOf(unwrap(other));
  }

  equals(other: DocHandle<unknown>): boolean {
    return this.#handle.equals(unwrap(other));
  }

  // A ref or cursor made from a sub-handle must name the presented document,
  // not the clone, or it won't resolve back through the draft. Cached by
  // presented url so a swap can re-base every live sub-handle.
  sub(...segments: unknown[]): DocHandle<unknown> {
    const backingSub = subOf(this.#handle, segments);
    const presented = restampUrl(this.#presentedUrl, backingSub.url);
    const cached = this.#subs.get(presented);
    if (cached) return cached.wrapped as unknown as DocHandle<unknown>;
    const wrapped = new DraftHandle<unknown>({
      presentedUrl: presented,
      backing: backingSub,
      beforeWrite: this.#beforeWrite,
    });
    this.#subs.set(presented, { wrapped, segments });
    return wrapped as unknown as DocHandle<unknown>;
  }

  on(ev: string, fn: Listener): DraftHandle<T> {
    this.#forward(ev);
    let set = this.#listeners.get(ev);
    if (!set) {
      set = new Set();
      this.#listeners.set(ev, set);
    }
    set.add(fn);
    return this.#self;
  }

  off(ev: string, fn: Listener): DraftHandle<T> {
    this.#listeners.get(ev)?.delete(fn);
    return this.#self;
  }

  once(ev: string, fn: Listener): DraftHandle<T> {
    const wrapper: Listener = (...args) => {
      this.off(ev, wrapper);
      fn(...args);
    };
    return this.on(ev, wrapper);
  }

  addListener(ev: string, fn: Listener): DraftHandle<T> {
    return this.on(ev, fn);
  }

  removeListener(ev: string, fn: Listener): DraftHandle<T> {
    return this.off(ev, fn);
  }

  removeAllListeners(ev?: string): DraftHandle<T> {
    if (ev) this.#listeners.get(ev)?.clear();
    else this.#listeners.clear();
    return this.#self;
  }

  // Unlike Node's EventEmitter, a throwing listener is logged rather than
  // starving the rest, and a listener removed mid-emit is skipped: a
  // scopeReplaced consumer may tear down a later listener (codemirror
  // replacing its sync plugin), which must not then run against stale state.
  emit(ev: string, ...args: unknown[]): boolean {
    const set = this.#listeners.get(ev);
    if (!set || set.size === 0) return false;
    for (const fn of [...set]) {
      if (!set.has(fn)) continue;
      try {
        fn(...args);
      } catch (err) {
        console.error(
          `[drafts] "${ev}" listener on ${this.#presentedUrl} threw:`,
          err
        );
      }
    }
    return true;
  }

  dispose(): void {
    for (const [ev, forwarder] of this.#forwarders) {
      emitter(this.#handle).off(ev, forwarder);
    }
    this.#forwarders.clear();
    this.#listeners.clear();
    for (const entry of this.#subs.values()) entry.wrapped.dispose();
    this.#subs.clear();
  }

  #forward(ev: string): void {
    if (this.#forwarders.has(ev)) return;
    const forwarder: Listener = (payload: unknown) => {
      if (payload && typeof payload === "object" && "handle" in payload) {
        this.emit(ev, { ...payload, handle: this.#self });
      } else {
        this.emit(ev, payload);
      }
    };
    this.#forwarders.set(ev, forwarder);
    emitter(this.#handle).on(ev, forwarder);
  }
}

export function unwrap<T>(handle: DocHandle<T>): DocHandle<T> {
  return handle instanceof DraftHandle
    ? (handle.backingHandle as DocHandle<T>)
    : handle;
}

/**
 * Serve the `owned` properties from `overrides` and forward everything else
 * to `backing`, re-read on every access so the owner can swap it under a
 * stable identity. Functions are bound to whichever side they came from, so
 * private fields and borrowed methods both keep the right `this`.
 */
export function forwardingProxy<T>(
  overrides: object,
  backing: object | (() => object),
  owned: ReadonlySet<PropertyKey>
): T {
  const current =
    typeof backing === "function" ? (backing as () => object) : () => backing;
  return new Proxy(overrides, {
    get(target, prop) {
      const source = owned.has(prop) ? target : current();
      const value = Reflect.get(source, prop, source);
      return typeof value === "function" ? value.bind(source) : value;
    },
    has(target, prop) {
      return owned.has(prop) || prop in current() || prop in target;
    },
  }) as T;
}

function subOf(handle: object, segments: unknown[]): DocHandle<unknown> {
  return (
    handle as { sub: (...s: unknown[]) => DocHandle<unknown> }
  ).sub(...segments);
}

function emitter(handle: object) {
  return handle as unknown as {
    on(ev: string, fn: Listener): void;
    off(ev: string, fn: Listener): void;
  };
}

// Keep the backing url's path and heads, but name the presented document.
function restampUrl(
  presentedRoot: AutomergeUrl,
  backingUrl: AutomergeUrl
): AutomergeUrl {
  const { documentId } = parseAutomergeUrl(presentedRoot);
  const { segments, heads } = parseAutomergeUrl(backingUrl);
  return stringifyAutomergeUrl({ documentId, segments, heads });
}
