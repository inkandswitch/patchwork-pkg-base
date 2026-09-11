import "./styles.css";
// Pulls in <patchwork-view> JSX intrinsic type augmentations.
import type {} from "@inkandswitch/patchwork-elements";
import {
  createSignal,
  createMemo,
  createEffect,
  onCleanup,
  Show,
  For,
} from "solid-js";

import { useRepo } from "solid-automerge";
import {
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";

import {
  subscribeDoc,
  subscribe,
} from "@inkandswitch/patchwork-providers-solid";
import { subscribe as subscribeProvider } from "@inkandswitch/patchwork-providers";

import { DraftReviewBar } from "./draft-review";

type CommentEntry = { targetUrl: AutomergeUrl; threadUrl: AutomergeUrl };

export function CommentsView(props: { element: HTMLElement }) {
  const repo = useRepo();

  // The doc the panel is about: whatever is currently selected in the main
  // view. Both the comment list and document-level "Add comment" target it.
  const selectedDocUrls = subscribe<AutomergeUrl[]>(
    props.element,
    { type: "patchwork:selected-doc" },
    []
  );
  const targetDocUrl = () => selectedDocUrls()[0] as AutomergeUrl | undefined;

  // Scope the comments subscription to the selected doc and re-open it when
  // that changes. A single global (url-less) subscription would accumulate
  // every mounted doc's threads and never drop the previous document's
  // comments as you navigate.
  const commentEntries = useScopedCommentEntries(props.element, targetDocUrl);

  // `selection` is read-only input (driven by the active editor), `highlight`
  // is our output. Splitting them avoids the feedback loop a single shared
  // map would have. `openThread` is a one-shot reveal request from another
  // view (e.g. the drafts timeline), consumed below.
  const [focusDoc, focusHandle] = subscribeDoc<{
    selection: Record<AutomergeUrl, true>;
    highlight: Record<AutomergeUrl, true>;
    openThread?: { url: AutomergeUrl; at: number };
  }>(props.element, { type: "patchwork:focus" });

  const [, contactHandle] = subscribeDoc<Record<string, never>>(props.element, {
    type: "patchwork:contact",
  });
  const currentContactUrl = () =>
    contactHandle()?.url as AutomergeUrl | undefined;

  const threadUrls = createMemo<AutomergeUrl[]>(() => {
    const entries = commentEntries();
    const threadUrls = new Set<AutomergeUrl>();
    for (const { threadUrl } of entries) {
      threadUrls.add(threadUrl);
    }
    return Array.from(threadUrls);
  });

  const threadTargetUrlMap = createMemo<Map<AutomergeUrl, AutomergeUrl[]>>(
    () => {
      const entries = commentEntries();
      const map = new Map<AutomergeUrl, AutomergeUrl[]>();
      for (const { targetUrl, threadUrl } of entries) {
        const existing = map.get(threadUrl);
        if (existing) {
          if (!existing.includes(targetUrl)) existing.push(targetUrl);
        } else {
          map.set(threadUrl, [targetUrl]);
        }
      }
      return map;
    }
  );

  const selectedHandles = useResolvedHandles(
    () => Object.keys(focusDoc()?.selection ?? {}) as AutomergeUrl[],
    repo
  );

  const threadTargetHandleMap = useResolvedHandleMap(threadTargetUrlMap, repo);

  // A thread is only worth showing if at least one of its targets still
  // points at something: a non-empty span for a ranged target, a value that
  // still resolves for an unranged one — see `targetIsVisible`.
  const threadTargets = useThreadTargets(threadTargetUrlMap, repo);

  // What the panel renders. Unranged threads are included by the same test
  // as ranged ones, so a comment on an entity lists exactly like a comment on
  // a phrase — the difference between them is only where they can be reached
  // from, not whether they exist.
  const displayedThreadUrls = createMemo<AutomergeUrl[]>(() =>
    threadUrls().filter((url) => threadTargets().visible.has(url))
  );

  // Only ranged threads can overlap a cursor; unranged ones are reached by
  // being clicked, which `primaryThreadUrl` honours below.
  const overlappingThreads = createMemo<AutomergeUrl[]>(() =>
    displayedThreadUrls().filter((url) =>
      threadOverlapsSelection(
        threadTargetHandleMap().get(url) ?? [],
        selectedHandles()
      )
    )
  );

  // Tiebreaker for when several threads share the same range — without it
  // the second of two threads on the same target would be unselectable.
  const [pinnedThread, setPinnedThread] = createSignal<
    AutomergeUrl | undefined
  >();

  const primaryThreadUrl = createMemo<AutomergeUrl | undefined>(() => {
    const pinned = pinnedThread();
    // An unranged thread — on the document, or on an entity within it — has
    // no range to overlap the selection and never appears in
    // `overlappingThreads`. The only way for one to become primary is by
    // being explicitly pinned (clicked).
    if (pinned && threadTargets().unranged.has(pinned)) return pinned;
    const overlaps = overlappingThreads();
    if (overlaps.length === 0) return undefined;
    if (pinned && overlaps.includes(pinned)) return pinned;
    return overlaps[0];
  });

  const secondaryThreadUrls = createMemo(() => {
    const p = primaryThreadUrl();
    return new Set(overlappingThreads().filter((u) => u !== p));
  });

  createEffect(() => {
    const handle = focusHandle();
    if (!handle) return;
    const p = primaryThreadUrl();
    const urls = p ? (threadTargetUrlMap().get(p) ?? []) : [];
    const desired: Record<AutomergeUrl, true> = {};
    for (const u of urls) desired[u] = true;
    handle.change((doc) => {
      doc.highlight = desired;
    });
  });

  // Clicking a thread card pins it and jumps `selection` to its targets;
  // the editor's next cursor move will overwrite `selection` again.
  const onSelectThread = (
    threadUrl: AutomergeUrl,
    targetUrls: AutomergeUrl[]
  ) => {
    const handle = focusHandle();
    if (!handle) return;
    const wasPrimary = primaryThreadUrl() === threadUrl;
    setPinnedThread(wasPrimary ? undefined : threadUrl);
    const next: Record<AutomergeUrl, true> = {};
    if (!wasPrimary) for (const u of targetUrls) next[u] = true;
    handle.change((doc) => {
      doc.selection = next;
    });
  };

  // Card clicks bubble up from the thread tool. Ignore clicks on interactive
  // controls (its buttons / draft textarea) so they don't also select.
  const onClickThreadCard = (e: MouseEvent, threadUrl: AutomergeUrl) => {
    const target = e.target as HTMLElement | null;
    if (
      target?.closest("textarea, button, input, a, select, .cm-editor")
    )
      return;
    onSelectThread(threadUrl, threadTargetUrlMap().get(threadUrl) ?? []);
  };

  // The selection state we hand each thread tool via `data-thread-state`.
  const threadState = (threadUrl: AutomergeUrl): string =>
    primaryThreadUrl() === threadUrl
      ? "primary"
      : secondaryThreadUrls().has(threadUrl)
        ? "secondary"
        : "inactive";

  // Rendered thread-card elements, for scrolling a revealed thread into view.
  // Stale entries for unmounted cards are harmless — only urls in the current
  // displayed list are ever looked up.
  const cardEls = new Map<AutomergeUrl, HTMLElement>();

  // Consume `openThread` reveal requests from the focus doc (written by e.g.
  // the drafts timeline): once the thread's card is in the rendered list, pin
  // and select it — same as clicking the card — scroll it into view, and
  // delete the request. A request whose card never appears (a resolved
  // thread, which the panel doesn't list) is dropped once it goes stale, so
  // it can't pin some unrelated selection much later.
  const OPEN_THREAD_TTL_MS = 5_000;
  createEffect(() => {
    const request = focusDoc()?.openThread;
    const handle = focusHandle();
    if (!request || !handle) return;
    if (Date.now() - request.at > OPEN_THREAD_TTL_MS) {
      handle.change((doc) => {
        delete doc.openThread;
      });
      return;
    }
    // Not rendered yet: wait — the effect re-runs as the list fills in.
    if (!displayedThreadUrls().includes(request.url)) return;
    const targetUrls = threadTargetUrlMap().get(request.url) ?? [];
    setPinnedThread(request.url);
    const next: Record<AutomergeUrl, true> = {};
    for (const u of targetUrls) next[u] = true;
    handle.change((doc) => {
      doc.selection = next;
      delete doc.openThread;
    });
    requestAnimationFrame(() =>
      cardEls
        .get(request.url)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    );
  });

  onCleanup(() => {
    const handle = focusHandle();
    if (!handle) return;
    handle.change((doc) => {
      doc.highlight = {} as Record<AutomergeUrl, true>;
    });
  });

  return (
    <div class="comments-panel">
      <div class="comments-panel-header">
        <span class="comments-panel-header-title">Comments</span>
      </div>
      {/* Only renders while a draft is checked out and a drafts tool is
          answering; on main it is absent entirely. */}
      <DraftReviewBar
        element={props.element}
        repo={repo}
        contactUrl={currentContactUrl}
      />
      <Show
        when={displayedThreadUrls().length > 0}
        fallback={<div class="comments-empty">No comments yet</div>}
      >
        <For each={displayedThreadUrls()}>
          {(threadUrl) => (
            <div
              class="comments-thread"
              ref={(el) => cardEls.set(threadUrl, el)}
              onClick={(e) => onClickThreadCard(e, threadUrl)}
            >
              <patchwork-view
                doc-url={threadUrl}
                tool-id="comment-thread"
                attr:data-thread-state={threadState(threadUrl)}
              />
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

// Open a `patchwork:comments` subscription scoped to `docUrl()` and re-open
// it whenever the selected doc changes, clearing entries in between so the
// previous document's comments don't linger. Returns the current doc's
// entries (empty when nothing is selected).
function useScopedCommentEntries(
  element: HTMLElement,
  docUrl: () => AutomergeUrl | undefined
): () => CommentEntry[] {
  const [entries, setEntries] = createSignal<CommentEntry[]>([]);
  createEffect(() => {
    const url = docUrl();
    setEntries([]);
    if (!url) return;
    const unsubscribe = subscribeProvider<CommentEntry[]>(
      element,
      { type: "patchwork:comments", url },
      (value) => setEntries(value ?? [])
    );
    onCleanup(unsubscribe);
  });
  return entries;
}

// Reactively resolve a list of urls into live sub-handles. Re-resolves
// whenever the url list changes; resolution is async (`repo.find`) so the
// accessor lags one tick behind the urls.
function useResolvedHandles(
  urls: () => AutomergeUrl[],
  repo: Repo
): () => DocHandle<unknown>[] {
  const [handles, setHandles] = createSignal<DocHandle<unknown>[]>([]);
  createEffect(() => {
    const list = urls();
    let cancelled = false;
    Promise.all(list.map((u) => repo.find(u).catch(() => undefined))).then(
      (resolved) => {
        if (cancelled) return;
        setHandles(resolved.filter((h): h is DocHandle<unknown> => Boolean(h)));
      }
    );
    onCleanup(() => {
      cancelled = true;
    });
  });
  return handles;
}

// Same as `useResolvedHandles` but for a keyed map of url lists.
function useResolvedHandleMap(
  map: () => Map<AutomergeUrl, AutomergeUrl[]>,
  repo: Repo
): () => Map<AutomergeUrl, DocHandle<unknown>[]> {
  const [resolved, setResolved] = createSignal<
    Map<AutomergeUrl, DocHandle<unknown>[]>
  >(new Map());
  createEffect(() => {
    const m = map();
    let cancelled = false;
    void (async () => {
      const out = new Map<AutomergeUrl, DocHandle<unknown>[]>();
      for (const [key, urls] of m) {
        const handles = await Promise.all(
          urls.map((u) => repo.find(u).catch(() => undefined))
        );
        out.set(
          key,
          handles.filter((h): h is DocHandle<unknown> => Boolean(h))
        );
      }
      if (!cancelled) setResolved(out);
    })();
    onCleanup(() => {
      cancelled = true;
    });
  });
  return resolved;
}

// Resolves each thread's target urls into live handles and sorts the threads
// two ways: which have at least one visible target, and which are unranged.
// Re-runs when the url map changes, and recomputes live when any resolved
// target doc changes — so a thread whose commented text gets deleted
// disappears without waiting for a re-resolve.
function useThreadTargets(
  map: () => Map<AutomergeUrl, AutomergeUrl[]>,
  repo: Repo
): () => ThreadTargets {
  const [targets, setTargets] = createSignal<ThreadTargets>(EMPTY_TARGETS);
  createEffect(() => {
    const m = map();
    let cancelled = false;
    let resolved = new Map<AutomergeUrl, DocHandle<unknown>[]>();

    const recompute = () => {
      if (cancelled) return;
      const visible = new Set<AutomergeUrl>();
      const unranged = new Set<AutomergeUrl>();
      for (const [threadUrl, handles] of resolved) {
        if (handles.some(targetIsVisible)) visible.add(threadUrl);
        if (handles.length > 0 && handles.every(targetIsUnranged)) {
          unranged.add(threadUrl);
        }
      }
      setTargets({ visible, unranged });
    };

    void (async () => {
      const out = new Map<AutomergeUrl, DocHandle<unknown>[]>();
      for (const [threadUrl, urls] of m) {
        const handles = await Promise.all(
          urls.map((u) => repo.find(u).catch(() => undefined))
        );
        out.set(
          threadUrl,
          handles.filter((h): h is DocHandle<unknown> => Boolean(h))
        );
      }
      if (cancelled) return;
      resolved = out;
      for (const h of flatHandles(resolved)) h.on("change", recompute);
      recompute();
    })();

    onCleanup(() => {
      cancelled = true;
      for (const h of flatHandles(resolved)) h.off("change", recompute);
    });
  });
  return targets;
}

// Threads sorted by what their targets are, not by what the urls look like.
type ThreadTargets = {
  /** At least one target still points at something worth showing. */
  visible: Set<AutomergeUrl>;
  /**
   * Every target is a whole value rather than a span: the document itself, an
   * entity in a list, a field. These have no range to overlap a selection, so
   * they become primary by being clicked rather than by the cursor landing in
   * them.
   */
  unranged: Set<AutomergeUrl>;
};

const EMPTY_TARGETS: ThreadTargets = {
  visible: new Set(),
  unranged: new Set(),
};

function flatHandles(
  map: Map<AutomergeUrl, DocHandle<unknown>[]>
): DocHandle<unknown>[] {
  const out: DocHandle<unknown>[] = [];
  for (const handles of map.values()) out.push(...handles);
  return out;
}

/**
 * Whether a target still points at something worth showing a thread for.
 *
 * A ranged target — a cursor-anchored span of text — must still resolve and
 * span at least one character: an empty range means the commented text was
 * deleted. Mirrors `buildCommentDecorations` in the codemirror tool.
 *
 * An unranged target is a whole value rather than a span, so there is no
 * range to measure; it is visible for as long as it resolves. That covers a
 * comment on the document itself and a comment on an entity inside it (a
 * place in a Petri net, a row, a card), and it fails in the same way a
 * ranged target does: delete the value and the thread stops being listed.
 */
function targetIsVisible(handle: DocHandle<unknown>): boolean {
  const positions = handle.rangePositions();
  if (!positions) return handle.doc() !== undefined;
  const [start, end] = positions;
  return start !== end;
}

const targetIsUnranged = (handle: DocHandle<unknown>): boolean =>
  handle.rangePositions() === undefined;

function threadOverlapsSelection(
  targets: DocHandle<unknown>[],
  selection: DocHandle<unknown>[]
): boolean {
  return targets.some((t) => selection.some((s) => s.overlaps(t)));
}

