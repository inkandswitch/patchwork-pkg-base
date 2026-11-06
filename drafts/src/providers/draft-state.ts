import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";

import type {
  ActorAttributionDoc,
  Baseline,
  CloneEntry,
  DraftDoc,
  DraftList,
  DraftMemberDoc,
  DraftSelection,
  DraftSummary,
  HasDrafts,
} from "../draft-types.js";
import { canonicalUrl } from "../clone-policy.js";
import {
  createActorRecorder,
  ensureActorAttribution,
} from "../actor-attribution.js";
import { createDraftRouter } from "../draft-routing.js";
import { ensureMainDraft } from "../draft-docs.js";
import { watchDocTree } from "../doc-tree.js";
import { isContainerType, isWorkspaceFolder } from "../folder-links.js";

export type DraftStateOptions = {
  repo: Repo;
  // The draft root: a single doc, or a workspace folder.
  docUrl: AutomergeUrl;
  selection: () => DraftSelection;
  // Check out a draft (null for main) at its live heads.
  select: (draftUrl: AutomergeUrl | null) => void;
  // Where the actor recorder subscribes for the current contact.
  element: HTMLElement;
};

export type DraftState = {
  subscribeList: (respond: (list: DraftList) => void) => () => void;
  subscribeBaseline: (
    target: AutomergeUrl,
    respond: (baseline: Baseline) => void
  ) => () => void;
  // The user moved the selection; it's reflected into the `draft=` URL.
  selectionChanged: () => void;
  // The selection was set without the user choosing it (restored at mount).
  refresh: () => void;
  dispose: () => void;
};

// The draft state of one root, behind the `draft:list` and `draft:baseline`
// subscriptions:
//   - `draft:list` → DraftList: the read-only main entry plus one
//     `DraftSummary` per non-merged draft, each carrying its member docs (on a
//     draft, the docs it has cloned; on main, every doc in the root's tree,
//     fork fields `null`).
//   - `draft:baseline` → the checkpoint's per-doc `from` for one doc.
//
// The link from a root to its drafts is `@patchwork.mainDraftUrl` → the main
// draft, whose `drafts` roots the tree; each `DraftDoc` may have its own
// sub-drafts via `DraftDoc.drafts`.
//
// Viewing a document costs nothing persistent. The root's draft bookkeeping
// (its main draft and ActorAttributionDoc) is created on demand: when the
// sidebar first subscribes to `draft:list`, or when the user first edits a
// member doc. A folder only gets it once it has been made a workspace, so
// looking at a folder doesn't make it one.
export function createDraftState(options: DraftStateOptions): DraftState {
  const { repo, docUrl, selection } = options;

  let hostDocHandle: DocHandle<HasDrafts> | null = null;
  const trackedDrafts = new Map<AutomergeUrl, DocHandle<DraftDoc>>();
  // The root's single main draft (bookkeeping only). Resolved lazily from
  // `@patchwork.mainDraftUrl`; its `drafts` roots the draft tree.
  let mainDraftHandle: DocHandle<DraftDoc> | null = null;

  const draftRouter = createDraftRouter({
    checkedOut: () => selection().checkedOut,
    select: options.select,
    covers: (url) => mainTree.has(canonicalUrl(url)),
  });

  // `draft:baseline` subscribers, keyed by canonical target url. Each is served the
  // checkpoint's per-doc `from` (see `currentBaseline`). Re-emitted whenever
  // the selection changes.
  const baselineSubscribers = new Map<
    AutomergeUrl,
    Set<(baseline: Baseline) => void>
  >();
  const sentBaselines = new Map<AutomergeUrl, UrlHeads | null>();

  // `draft:list` bookkeeping: the last computed list, its live subscribers, and
  // the draft order from the most recent rewalk.
  const listSubscribers = new Set<(list: DraftList) => void>();
  let orderedDraftUrls: AutomergeUrl[] = [];
  let draftList: DraftList = {
    main: {
      url: docUrl,
      parent: null,
      members: [],
      childCount: 0,
      name: null,
    },
    drafts: [],
    actorAttributionUrl: null,
  };
  // Author attribution: stamps actor ids from local member-doc changes into
  // the root's shared ActorAttributionDoc.
  const actorRecorder = createActorRecorder(
    options.element,
    repo,
    ensureAttribution
  );
  // Main's members: the root and everything beneath it.
  const mainTree = watchDocTree(repo, docUrl, { onChange: () => reconcile() });

  let disposed = false;
  let rewalkInFlight = false;
  let rewalkPending = false;
  let mainDraftReady: Promise<DocHandle<DraftDoc> | null> | null = null;
  let attributionReady: Promise<DocHandle<ActorAttributionDoc> | null> | null =
    null;
  // A tracked draft changing can mean either its sub-draft list moved (needs a
  // rewalk) or its clone map grew (needs a list recompute), so do both.
  const onTrackedChange = () => {
    scheduleRewalk();
    reconcile();
  };
  const onHostDocChange = () => {
    const url = hostDocHandle?.doc()?.["@patchwork"]?.mainDraftUrl ?? null;
    if (url !== (mainDraftHandle?.url ?? null)) scheduleRewalk();
  };

  const ready: Promise<void> = (async () => {
    const handle = await repo.find<HasDrafts>(docUrl);
    if (disposed) return;
    hostDocHandle = handle;
    handle.on("change", onHostDocChange);
    scheduleRewalk();
    reconcile();
  })();
  ready.catch((err) => {
    console.error(`[drafts] failed to initialize draft state:`, err);
  });

  return {
    subscribeList(respond) {
      respond(draftList);
      listSubscribers.add(respond);
      if (listSubscribers.size === 1) activate();
      return () => {
        listSubscribers.delete(respond);
      };
    },
    subscribeBaseline(target, respond) {
      const baseline = currentBaseline(target);
      sentBaselines.set(target, baseline.heads);
      respond(baseline);
      let set = baselineSubscribers.get(target);
      if (!set) baselineSubscribers.set(target, (set = new Set()));
      set.add(respond);
      return () => {
        set!.delete(respond);
        if (set!.size === 0) {
          baselineSubscribers.delete(target);
          sentBaselines.delete(target);
        }
      };
    },
    selectionChanged() {
      if (disposed) return;
      draftRouter.selectionChanged();
      refresh();
    },
    refresh,
    dispose,
  };

  // The selection may have moved: re-publish baselines whose checkpoint
  // entry changed, and the docs the actor recorder watches.
  function refresh(): void {
    if (disposed) return;
    notifyBaselines();
    reconcile();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    mainTree.dispose();
    actorRecorder.dispose();
    draftRouter.dispose();
    hostDocHandle?.off("change", onHostDocChange);
    mainDraftHandle?.off("change", onTrackedChange);
    for (const [, h] of trackedDrafts) h.off("change", onTrackedChange);
    mainDraftHandle = null;
    trackedDrafts.clear();
    listSubscribers.clear();
    baselineSubscribers.clear();
    sentBaselines.clear();
    hostDocHandle = null;
  }

  // The sidebar is open: make sure the root has its main draft, so the Main
  // timeline has a home.
  function activate(): void {
    ensureMainDraftDoc().then(
      () => reconcile(),
      (err) => console.warn("[drafts] failed to create main draft:", err)
    );
    reconcile();
  }

  // Resolve (creating on first use) the root's main draft. The only root-doc
  // side effect is the `mainDraftUrl` scalar, which the timeline's
  // `@patchwork` path skip filters out. Containers that aren't workspaces
  // yet are left alone (`null`) — drafting one is what makes it a
  // workspace. A failed attempt is retried next time.
  function ensureMainDraftDoc(): Promise<DocHandle<DraftDoc> | null> {
    if (mainDraftReady) return mainDraftReady;
    const attempt = (async () => {
      await ready;
      if (disposed || !hostDocHandle) return null;
      const hostDoc = hostDocHandle.doc();
      const hostType = hostDoc?.["@patchwork"]?.type;
      if (
        isContainerType(hostType) &&
        !isWorkspaceFolder(hostDoc) &&
        !hostDoc?.["@patchwork"]?.mainDraftUrl
      ) {
        return null;
      }
      const mainDraft = await ensureMainDraft(repo, hostDocHandle);
      if (disposed) return null;
      scheduleRewalk();
      return mainDraft;
    })();
    mainDraftReady = attempt;
    attempt.then(
      (mainDraft) => {
        if (!mainDraft && mainDraftReady === attempt) mainDraftReady = null;
      },
      () => {
        if (mainDraftReady === attempt) mainDraftReady = null;
      }
    );
    return attempt;
  }

  // The root's ActorAttributionDoc, created (with the main draft it hangs
  // off) on the first local edit — only writers need it.
  function ensureAttribution(): Promise<DocHandle<ActorAttributionDoc> | null> {
    if (attributionReady) return attributionReady;
    const attempt = ensureMainDraftDoc().then((mainDraft) =>
      mainDraft && !disposed ? ensureActorAttribution(repo, mainDraft) : null
    );
    attributionReady = attempt;
    attempt.then(
      (attribution) => {
        if (!attribution && attributionReady === attempt) {
          attributionReady = null;
        }
      },
      () => {
        if (attributionReady === attempt) attributionReady = null;
      }
    );
    return attempt;
  }

  function scheduleRewalk(): void {
    if (disposed) return;
    if (!hostDocHandle) return;
    if (rewalkInFlight) {
      rewalkPending = true;
      return;
    }
    rewalkInFlight = true;
    void (async () => {
      try {
        // Drafts hang off the main draft (`mainDraft.drafts`), which is created
        // on the first draft; until then there are none.
        const mainDraft = await ensureMainDraftTracked();
        if (disposed) return;
        const roots = (mainDraft?.doc()?.drafts ?? []).filter(
          isValidAutomergeUrl
        );
        const allDrafts = await collectAllDrafts(
          repo,
          roots,
          trackedDrafts,
          onTrackedChange,
          () => disposed
        );
        if (disposed) return;
        const reachable = new Set(allDrafts);
        for (const [url, handle] of trackedDrafts) {
          if (reachable.has(url)) continue;
          handle.off("change", onTrackedChange);
          trackedDrafts.delete(url);
        }
        orderedDraftUrls = allDrafts;
        draftRouter.updateAvailableDrafts(allDrafts);
      } catch (err) {
        console.error("[drafts] rewalk failed:", err);
      } finally {
        rewalkInFlight = false;
        // A rewalk may have just started tracking a draft (whose clones won't
        // fire their own change event), so refresh the list.
        reconcile();
        if (rewalkPending) {
          rewalkPending = false;
          scheduleRewalk();
        }
      }
    })();
  }

  // Bring everything derived from the current state up to date: which docs
  // the actor recorder watches, and the `draft:list` value, pushed to
  // subscribers when it actually changed.
  function reconcile(): void {
    if (disposed) return;
    actorRecorder.watch(writableDocUrls());
    const next = computeList();
    if (draftListsEqual(draftList, next)) return;
    draftList = next;
    for (const respond of listSubscribers) respond(next);
  }

  // The docs the user can write to right now: main's members, plus the
  // checked-out draft's clones, where the overlay routes edits.
  function writableDocUrls(): AutomergeUrl[] {
    const urls = [...mainTree.urls()];
    const selected = selection().checkedOut;
    const clones = selected
      ? trackedDrafts.get(selected)?.doc()?.clones
      : undefined;
    for (const entry of Object.values(clones ?? {})) {
      if (entry.cloneUrl) urls.push(canonicalUrl(entry.cloneUrl));
    }
    return urls;
  }

  // The full read-only list: the main entry plus one summary per non-merged
  // draft, in rewalk (tree) order.
  function computeList(): DraftList {
    const drafts: DraftSummary[] = [];
    for (const url of orderedDraftUrls) {
      const doc = trackedDrafts.get(url)?.doc();
      if (!doc || doc.mergedAt !== undefined) continue;
      drafts.push({
        url,
        parent: effectiveParent(doc.parent),
        members: clonesToMembers(doc.clones),
        childCount: doc.drafts.length,
        name: doc.name ?? null,
      });
    }
    return {
      main: computeMainSummary(),
      drafts,
      actorAttributionUrl:
        mainDraftHandle?.doc()?.actorAttributionUrl ?? null,
    };
  }

  // The parent a summary should point at: the nearest non-merged ancestor.
  // Merging normally re-parents children, but drafts orphaned before that
  // existed (or by a concurrent merge on another peer) still resolve to the
  // draft their parent was merged into instead of dangling under a hidden
  // one. Unknown urls (not tracked, e.g. the main draft) pass through as-is.
  function effectiveParent(
    parentUrl: AutomergeUrl | undefined
  ): AutomergeUrl | null {
    const seen = new Set<AutomergeUrl>();
    let cursor = parentUrl ?? null;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const doc = trackedDrafts.get(cursor)?.doc();
      if (!doc || doc.mergedAt === undefined) return cursor;
      cursor = doc.parent ?? null;
    }
    return cursor;
  }

  // Main's summary: every doc in the root's tree, sorted by url so the
  // diff above is positional.
  function computeMainSummary(): DraftSummary {
    const members = mainTree
      .urls()
      .map((url) => ({ url, cloneUrl: null, clonedAt: null }))
      .sort(byMemberUrl);
    return {
      url: mainDraftHandle?.url ?? docUrl,
      parent: null,
      members,
      childCount: mainDraftHandle?.doc()?.drafts.length ?? 0,
      name: mainDraftHandle?.doc()?.name ?? null,
    };
  }

  // The diff baseline for `target`: the checkpoint's per-doc `from`, written
  // by the sidebar (its eye toggle and scrubber). `null` — no entry, or an
  // entry without `from` — means no diff. There is deliberately no implicit
  // fork-point fallback: baselines exist only when explicitly written into
  // the checkpoint, so "diffs hidden" is simply their absence.
  function currentBaseline(target: AutomergeUrl): Baseline {
    const entry = selection().at?.[target];
    return { heads: entry?.from ?? null };
  }

  // Re-answer only the targets whose baseline actually moved: a re-send makes
  // every editor on that doc recompute its diff.
  function notifyBaselines(): void {
    for (const [target, set] of baselineSubscribers) {
      const baseline = currentBaseline(target);
      if (sameHeads(baseline.heads, sentBaselines.get(target) ?? null)) {
        continue;
      }
      sentBaselines.set(target, baseline.heads);
      for (const respond of [...set]) respond(baseline);
    }
  }

  // Resolve and start tracking the root's main draft, if any. Returns the
  // handle, or null when the root has no `mainDraftUrl` yet. Re-resolves when
  // the pointer changes and attaches `onTrackedChange` so the main draft's
  // `drafts` (tree shape) stays live.
  async function ensureMainDraftTracked(): Promise<DocHandle<DraftDoc> | null> {
    if (!hostDocHandle) return null;
    const mainDraftUrl = hostDocHandle.doc()?.["@patchwork"]?.mainDraftUrl;
    if (!mainDraftUrl || !isValidAutomergeUrl(mainDraftUrl)) return null;
    if (mainDraftHandle && mainDraftHandle.url === mainDraftUrl) {
      return mainDraftHandle;
    }
    if (mainDraftHandle) mainDraftHandle.off("change", onTrackedChange);
    const handle = await repo.find<DraftDoc>(mainDraftUrl);
    if (disposed) return null;
    mainDraftHandle = handle;
    handle.on("change", onTrackedChange);
    return handle;
  }
}

// Depth-first pre-order, so a fork lists directly beneath the draft it was
// forked off (the sidebar indents by parent depth).
async function collectAllDrafts(
  repo: Repo,
  roots: readonly AutomergeUrl[],
  tracked: Map<AutomergeUrl, DocHandle<DraftDoc>>,
  onNewChange: () => void,
  isDisposed: () => boolean
): Promise<AutomergeUrl[]> {
  const visited = new Set<AutomergeUrl>();
  const order: AutomergeUrl[] = [];
  const queue: AutomergeUrl[] = [...roots];
  while (queue.length) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    order.push(url);

    let h = tracked.get(url);
    if (!h) {
      h = await repo.find<DraftDoc>(url);
      if (isDisposed()) return order;
      tracked.set(url, h);
      h.on("change", onNewChange);
    }
    const drafts = (h.doc()?.drafts ?? []).filter(isValidAutomergeUrl);
    queue.unshift(...drafts);
  }
  return order;
}

// The docs a draft has cloned, as member-doc entries sorted by url so the
// positional equality checks below stay valid. Docs it only recorded a fork
// point for have no changes of their own yet.
function clonesToMembers(
  clones: Record<AutomergeUrl, CloneEntry>
): DraftMemberDoc[] {
  const members: DraftMemberDoc[] = [];
  for (const [url, entry] of Object.entries(clones)) {
    if (!entry.cloneUrl) continue;
    members.push({
      url: url as AutomergeUrl,
      cloneUrl: entry.cloneUrl,
      clonedAt: entry.clonedAt,
    });
  }
  return members.sort(byMemberUrl);
}

function draftListsEqual(a: DraftList, b: DraftList): boolean {
  if (a.actorAttributionUrl !== b.actorAttributionUrl) return false;
  if (!summariesEqual(a.main, b.main)) return false;
  if (a.drafts.length !== b.drafts.length) return false;
  for (let i = 0; i < a.drafts.length; i++) {
    if (!summariesEqual(a.drafts[i], b.drafts[i])) return false;
  }
  return true;
}

function summariesEqual(a: DraftSummary, b: DraftSummary): boolean {
  return (
    a.url === b.url &&
    a.parent === b.parent &&
    a.childCount === b.childCount &&
    a.name === b.name &&
    memberListsEqual(a.members, b.members)
  );
}

function byMemberUrl(a: DraftMemberDoc, b: DraftMemberDoc): number {
  return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
}

function memberListsEqual(a: DraftMemberDoc[], b: DraftMemberDoc[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].url !== b[i].url) return false;
    if (a[i].cloneUrl !== b[i].cloneUrl) return false;
    if (!sameHeads(a[i].clonedAt, b[i].clonedAt)) return false;
  }
  return true;
}

function sameHeads(a: UrlHeads | null, b: UrlHeads | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((h) => set.has(h));
}
