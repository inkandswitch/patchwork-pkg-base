import type {
  AutomergeUrl,
  Doc,
  DocHandle,
  DocHandleChangePayload,
} from "@automerge/automerge-repo/slim";
import { createMemo, onCleanup, type Accessor, type Resource } from "solid-js";
import { createStore, produce, reconcile, type Store } from "solid-js/store";
import { autoproduce, useDocHandle } from "solid-automerge";

/**
 * Drop-in replacements for solid-automerge's `useDocument` and
 * `makeDocumentProjection`.
 *
 * solid-automerge (as of 2.0.1) builds its store with
 * `createStore(handle.doc())`, i.e. the automerge document's own materialized
 * object becomes the store's raw object, and every patch is written into it
 * in place. `handle.doc()` returns the same object for every handle of a
 * document, so two projections on two handle objects of the same doc — which
 * is exactly what happens when several `<patchwork-view>`s each hold their
 * own overlay handle for the folder that's open — end up mutating one shared
 * array. Each projection applies the same insert patch, and a document added
 * to a folder shows up as many times as there are projections until a reload
 * rebuilds the store from scratch.
 *
 * Here the store starts from (and is only ever reconciled against) a copy of
 * the document, so a projection owns its state outright.
 */

type UseDocHandleOptions = Parameters<typeof useDocHandle>[1];

export function useDocument<T extends object>(
  url: Accessor<AutomergeUrl | undefined>,
  options?: UseDocHandleOptions
): [Accessor<Doc<T> | undefined>, Resource<DocHandle<T> | undefined>] {
  const handle = useDocHandle<T>(url, options);
  const projection = createMemo<Doc<T> | undefined>(() => {
    const h = handle();
    return h && makeDocumentProjection<T>(h);
  });
  return [projection, handle];
}

// `scopeReplaced` arrived with sub-handles in newer automerge-repo builds than
// the one this package types against; the shell's runtime does send it.
type ChangePayload<T> = DocHandleChangePayload<T> & { scopeReplaced?: boolean };

type CacheEntry = {
  refs: number;
  store: Store<Doc<unknown>>;
  cleanup(): void;
};

// One store per handle object, shared by everything projecting that handle
// within this bundle and torn down when the last user goes away.
const cache = new WeakMap<DocHandle<unknown>, CacheEntry>();

export function makeDocumentProjection<T extends object>(
  handle: DocHandle<T>
): Doc<T> {
  onCleanup(() => {
    const entry = cache.get(handle);
    if (entry && --entry.refs === 0) entry.cleanup();
  });

  const existing = cache.get(handle);
  if (existing) {
    existing.refs++;
    return existing.store as Doc<T>;
  }

  const [doc, set] = createStore<Doc<T>>(snapshot(handle.doc()!));

  function patch(payload: ChangePayload<T>) {
    // `scopeReplaced`: the change landed at or above this handle's scope, so
    // there are no in-scope patches; reconcile against the new value instead.
    // `doc` is undefined when the scope was removed entirely.
    if (payload.scopeReplaced) {
      set(reconcile(snapshot((payload.doc ?? {}) as Doc<T>)));
      return;
    }
    set(produce(autoproduce(payload)));
  }

  function ondelete() {
    set(reconcile({} as Doc<T>));
  }

  handle.on("change", patch);
  handle.on("delete", ondelete);

  cache.set(handle, {
    refs: 1,
    store: doc,
    cleanup() {
      handle.off("change", patch);
      handle.off("delete", ondelete);
      cache.delete(handle);
    },
  });

  return doc;
}

// A copy the store can own. Automerge's materialized doc is plain data, so a
// structured clone is faithful; it also sheds automerge's symbol-keyed internal
// state, which has no business in a Solid store.
function snapshot<T>(doc: T): T {
  return structuredClone(doc);
}
