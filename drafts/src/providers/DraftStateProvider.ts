import {
  encodeHeads,
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";
import type {
  MountedEvent,
  UnmountedEvent,
} from "@inkandswitch/patchwork-elements";

import type {
  ActorAttributionDoc,
  Baseline,
  CheckedOutDraft,
  CloneEntry,
  DraftDoc,
  DraftList,
  DraftMemberDoc,
  DraftSummary,
  HasDrafts,
} from "../draft-types.js";
import { SKIPPED_DATATYPES, canonicalUrl } from "../clone-policy.js";
import {
  createChangeGrouper,
  type TimelineGroupingSpec,
} from "../change-group-cache.js";
import {
  createActorRecorder,
  ensureActorAttribution,
} from "../actor-attribution.js";
import { createDraftRouter } from "../draft-routing.js";
import { ensureMainDraft } from "../draft-docs.js";

const ROOT_DOC_SELECTOR = "draft:root-doc";
const CHECKED_OUT_SELECTOR = "draft:checked-out";
const DRAFT_LIST_SELECTOR = "draft:list";
const BASELINE_SELECTOR = "draft:baseline";

const ATTR_DOC_URL = "doc-url";

// Fork point recorded for the main draft's identity clones: empty heads means
// "from the start", so `getChangesMetaSince(doc, [])` yields the full history.
const EMPTY_HEADS: UrlHeads = encodeHeads([]);

// One ephemeral CheckedOutDraft per host doc for the life of this realm. The
// host remounts this provider on every doc switch; a fresh doc per mount
// would be stored and synced to every peer each time (delete is local-only),
// so the doc is kept and reset to main on remount instead.
const checkoutDocs = new Map<AutomergeUrl, DocHandle<CheckedOutDraft>>();

function checkoutFor(
  repo: Repo,
  docUrl: AutomergeUrl
): DocHandle<CheckedOutDraft> {
  let handle = checkoutDocs.get(docUrl);
  if (!handle) {
    handle = repo.create<CheckedOutDraft>({ checkedOut: null });
    checkoutDocs.set(docUrl, handle);
    return handle;
  }
  const doc = handle.doc();
  if (doc?.checkedOut != null || doc?.at != null) {
    handle.change((d) => {
      d.checkedOut = null;
      d.at = null;
    });
  }
  return handle;
}

// Mounts on a document URL and exposes that document's draft state via three
// subscriptions:
//   - `draft:root-doc`    → AutomergeUrl of the doc this provider is on
//   - `draft:checked-out` → AutomergeUrl of the ephemeral, writeable
//     CheckedOutDraft doc; holds only the selection (`checkedOut = null` = main)
//   - `draft:list`        → DraftList: the read-only main entry plus one
//     `DraftSummary` per non-merged draft, each carrying its member docs (on a
//     draft, the forked docs from `DraftDoc.clones`; on main, the main draft's
//     identity clones, or — before the first draft — the docs mounted beneath
//     this provider observed via `patchwork:mounted`, fork fields `null`).
//
// Consumers recover the live `DocHandle`s from the realm-local `window.repo`,
// so member entries carry only plain `AutomergeUrl`s. The link from a host doc
// to its drafts is `@patchwork.mainDraftUrl` → the main draft, whose `drafts`
// roots the tree; each `DraftDoc` may have its own sub-drafts via
// `DraftDoc.drafts`.
//
// Viewing a document costs nothing persistent. The host doc's draft
// bookkeeping (its main draft and ActorAttributionDoc) is created on demand:
// when the sidebar first subscribes to `draft:list`, or when the user first
// edits a doc beneath us. Timelines are grouped only while a `draft:list`
// subscriber exists.
export const DraftStateProvider = (element: HTMLElement) => {
  const rawUrl = element.getAttribute(ATTR_DOC_URL);
  if (!rawUrl || !isValidAutomergeUrl(rawUrl)) {
    console.warn(
      `[drafts] <patchwork-view component="patchwork-draft-state-provider"> ` +
        `is missing a valid ${ATTR_DOC_URL} attribute (got ${JSON.stringify(rawUrl)})`
    );
    return () => {};
  }
  const docUrl: AutomergeUrl = rawUrl;

  const maybeRepo = "repo" in window ? window.repo : undefined;
  if (!maybeRepo) {
    console.warn(
      "[drafts] window.repo is not set; draft-state provider disabled"
    );
    return () => {};
  }
  const repo: Repo = maybeRepo;

  let hostDocHandle: DocHandle<HasDrafts> | null = null;
  const trackedDrafts = new Map<AutomergeUrl, DocHandle<DraftDoc>>();
  // The host doc's single main draft (bookkeeping only). Resolved lazily from
  // `@patchwork.mainDraftUrl`; its `drafts` roots the draft tree and its
  // identity `clones` back the "main" member list.
  let mainDraftHandle: DocHandle<DraftDoc> | null = null;

  const checkedOutHandle = checkoutFor(repo, docUrl);
  const draftRouter = createDraftRouter(checkedOutHandle);

  // `draft:baseline` subscribers, keyed by canonical target url. This provider
  // is the sole answerer (the overlay no longer claims it), serving the
  // checkpoint's per-doc `from` (see `currentBaseline`). Re-emitted whenever
  // the checkout doc changes.
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
      changeGroupDocUrl: null,
    },
    drafts: [],
    actorAttributionUrl: null,
  };
  // Author attribution: stamps actor ids from local member-doc changes into
  // the host doc's shared ActorAttributionDoc.
  const actorRecorder = createActorRecorder(element, repo, ensureAttribution);
  // Groups each timeline into its ChangeGroupDoc while the sidebar is open.
  const changeGrouper = createChangeGrouper(repo);
  // Main-case membership: docs mounted beneath this provider, ref-counted so a
  // doc shown in several views is only dropped on its last unmount. Populated
  // even while a draft is selected (where it goes unused) so switching back to
  // main is instant.
  const mountCounts = new Map<AutomergeUrl, number>();
  // Cached "is this an app-global datatype we skip?" verdict per mounted url,
  // resolved lazily since reading `@patchwork.type` means loading the doc.
  // Absent = unresolved, treated as not-skipped (visible) until known.
  const skipVerdicts = new Map<AutomergeUrl, boolean>();

  let disposed = false;
  let rewalkInFlight = false;
  let rewalkPending = false;
  let cloneSyncTimer: ReturnType<typeof setTimeout> | null = null;
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
  // The checkout doc changed: its checkpoint may have moved, so re-publish
  // every live `draft:baseline` subscriber.
  const onCheckedOutChange = () => {
    notifyBaselines();
    reconcile();
  };

  const onMounted = (event: MountedEvent) => {
    const detail = event.detail;
    if (!("url" in detail)) return;
    const url = canonicalUrl(detail.url);
    mountCounts.set(url, (mountCounts.get(url) ?? 0) + 1);
    ensureSkipVerdict(url);
    scheduleCloneSync();
    reconcile();
  };

  const onUnmounted = (event: UnmountedEvent) => {
    const detail = event.detail;
    if (!("url" in detail)) return;
    const url = canonicalUrl(detail.url);
    const count = mountCounts.get(url) ?? 0;
    if (count <= 1) mountCounts.delete(url);
    else mountCounts.set(url, count - 1);
    reconcile();
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
    console.error(`[drafts] failed to initialize draft-state provider:`, err);
  });

  checkedOutHandle.on("change", onCheckedOutChange);

  const onSubscribe = (event: SubscribeEvent) => {
    const { type } = event.detail.selector;

    if (type === ROOT_DOC_SELECTOR) {
      accept<AutomergeUrl>(event, (respond) => {
        respond(docUrl);
      });
      return;
    }

    if (type === CHECKED_OUT_SELECTOR) {
      accept<AutomergeUrl>(event, (respond) => {
        respond(checkedOutHandle.url);
      });
      return;
    }

    if (type === DRAFT_LIST_SELECTOR) {
      // `draft:list` answers with a DraftList *object*, never an AutomergeUrl, so
      // consumers must use `subscribe` (not `subscribeDoc`, which would feed this
      // object into `repo.find` and crash with "Invalid AutomergeUrl").
      accept<DraftList>(event, (respond) => {
        respond(draftList);
        listSubscribers.add(respond);
        if (listSubscribers.size === 1) activate();
        return () => {
          listSubscribers.delete(respond);
          if (listSubscribers.size === 0) deactivate();
        };
      });
      return;
    }

    if (type === BASELINE_SELECTOR) {
      // Sole answerer for `draft:baseline` (the overlay no longer claims it):
      // serves the checkpoint's per-doc `from` for `target` (see
      // `currentBaseline`).
      const rawTarget = (event.detail.selector as { url?: unknown }).url;
      if (typeof rawTarget !== "string" || !isValidAutomergeUrl(rawTarget)) {
        return;
      }
      const target = canonicalUrl(rawTarget);
      accept<Baseline>(event, (respond) => {
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
      });
      return;
    }
  };

  element.addEventListener("patchwork:subscribe", onSubscribe);
  element.addEventListener("patchwork:mounted", onMounted);
  element.addEventListener("patchwork:unmounted", onUnmounted);

  return () => {
    disposed = true;
    if (cloneSyncTimer !== null) clearTimeout(cloneSyncTimer);
    changeGrouper.dispose();
    actorRecorder.dispose();
    draftRouter.dispose();
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    element.removeEventListener("patchwork:mounted", onMounted);
    element.removeEventListener("patchwork:unmounted", onUnmounted);
    hostDocHandle?.off("change", onHostDocChange);
    mainDraftHandle?.off("change", onTrackedChange);
    for (const [, h] of trackedDrafts) h.off("change", onTrackedChange);
    checkedOutHandle.off("change", onCheckedOutChange);
    mainDraftHandle = null;
    trackedDrafts.clear();
    listSubscribers.clear();
    baselineSubscribers.clear();
    sentBaselines.clear();
    mountCounts.clear();
    skipVerdicts.clear();
    hostDocHandle = null;
  };

  // The sidebar is open: make sure the host doc has its main draft (so the
  // Main timeline has a home), record what's mounted as main's members, and
  // keep the timelines grouped.
  function activate(): void {
    ensureMainDraftDoc().then(
      () => {
        scheduleCloneSync();
        reconcile();
      },
      (err) => console.warn("[drafts] failed to create main draft:", err)
    );
    reconcile();
  }

  function deactivate(): void {
    changeGrouper.setTimelines([]);
  }

  // Resolve (creating on first use) the host doc's main draft. Main's clones
  // are identity mappings — nothing is forked; the only host-doc side effect
  // is the `mainDraftUrl` scalar, which the timeline's `@patchwork` path skip
  // filters out. App-global datatypes the draft machinery never treats as
  // content are left alone (`null`). A failed attempt is retried next time.
  function ensureMainDraftDoc(): Promise<DocHandle<DraftDoc> | null> {
    if (mainDraftReady) return mainDraftReady;
    const attempt = (async () => {
      await ready;
      if (disposed || !hostDocHandle) return null;
      const hostType = hostDocHandle.doc()?.["@patchwork"]?.type;
      if (hostType != null && SKIPPED_DATATYPES.has(hostType)) return null;
      const mainDraft = await ensureMainDraft(repo, hostDocHandle);
      if (disposed) return null;
      scheduleRewalk();
      return mainDraft;
    })();
    mainDraftReady = attempt;
    attempt.catch(() => {
      if (mainDraftReady === attempt) mainDraftReady = null;
    });
    return attempt;
  }

  // The host doc's ActorAttributionDoc, created (with the main draft it hangs
  // off) on the first local edit — only writers need it.
  function ensureAttribution(): Promise<DocHandle<ActorAttributionDoc> | null> {
    if (attributionReady) return attributionReady;
    const attempt = ensureMainDraftDoc().then((mainDraft) =>
      mainDraft && !disposed ? ensureActorAttribution(repo, mainDraft) : null
    );
    attributionReady = attempt;
    attempt.catch(() => {
      if (attributionReady === attempt) attributionReady = null;
    });
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
  // the actor recorder watches, which timelines are grouped (sidebar open
  // only), and the `draft:list` value, pushed to subscribers when it actually
  // changed.
  function reconcile(): void {
    if (disposed) return;
    actorRecorder.watch(writableDocUrls());
    if (listSubscribers.size > 0) updateChangeGrouping();
    const next = computeList();
    if (draftListsEqual(draftList, next)) return;
    draftList = next;
    for (const respond of listSubscribers) respond(next);
  }

  // The docs the user can write to right now: the mounted originals on main,
  // plus the checked-out draft's clones, where the overlay routes edits.
  function writableDocUrls(): AutomergeUrl[] {
    const urls = [...mountCounts.keys()].filter(
      (url) => skipVerdicts.get(url) === false
    );
    const selected = checkedOutHandle.doc()?.checkedOut ?? null;
    const clones = selected
      ? trackedDrafts.get(selected)?.doc()?.clones
      : undefined;
    for (const entry of Object.values(clones ?? {})) {
      urls.push(canonicalUrl(entry.cloneUrl));
    }
    return urls;
  }

  // Hand the ChangeGrouper the current timelines, priority-ordered: main,
  // checked-out draft, then the remaining drafts in tree order. Main reads
  // the main draft's identity clones rather than the mounted-doc fallback.
  function updateChangeGrouping(): void {
    if (disposed) return;
    const specs: TimelineGroupingSpec[] = [];
    if (mainDraftHandle) {
      specs.push({
        draftHandle: mainDraftHandle,
        members: clonesToMembers(mainDraftHandle.doc()?.clones ?? {}),
        rootDocUrl: docUrl,
      });
    }
    const selected = checkedOutHandle.doc()?.checkedOut ?? null;
    const ordered =
      selected && orderedDraftUrls.includes(selected)
        ? [selected, ...orderedDraftUrls.filter((u) => u !== selected)]
        : orderedDraftUrls;
    for (const url of ordered) {
      const handle = trackedDrafts.get(url);
      const doc = handle?.doc();
      if (!handle || !doc || doc.mergedAt !== undefined) continue;
      specs.push({
        draftHandle: handle,
        members: clonesToMembers(doc.clones),
        rootDocUrl: docUrl,
      });
    }
    changeGrouper.setTimelines(specs);
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
        changeGroupDocUrl: doc.changeGroupDocUrl ?? null,
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

  // Main's summary. Its members come from the main draft's identity clones once
  // it exists; before the first draft is created (no main draft) we fall back to
  // the docs mounted beneath us, minus the app-global datatypes the overlay
  // would never fork. Members are sorted by url so the diff above is positional.
  function computeMainSummary(): DraftSummary {
    const url = mainDraftHandle?.url ?? docUrl;
    const childCount = mainDraftHandle?.doc()?.drafts.length ?? 0;
    const name = mainDraftHandle?.doc()?.name ?? null;
    const changeGroupDocUrl =
      mainDraftHandle?.doc()?.changeGroupDocUrl ?? null;

    const mainClones = mainDraftHandle?.doc()?.clones;
    if (mainClones && Object.keys(mainClones).length > 0) {
      return {
        url,
        parent: null,
        members: clonesToMembers(mainClones),
        childCount,
        name,
        changeGroupDocUrl,
      };
    }

    const members = [...mountCounts.keys()]
      .filter((u) => skipVerdicts.get(u) !== true)
      .map((u) => ({ url: u, cloneUrl: null, clonedAt: null }))
      .sort(byMemberUrl);
    return { url, parent: null, members, childCount, name, changeGroupDocUrl };
  }

  // The diff baseline for `target`: the checkpoint's per-doc `from`, written
  // by the sidebar (its eye toggle and scrubber). `null` — no entry, or an
  // entry without `from` — means no diff. There is deliberately no implicit
  // fork-point fallback: baselines exist only when explicitly written into
  // the checkpoint, so "diffs hidden" is simply their absence.
  function currentBaseline(target: AutomergeUrl): Baseline {
    const entry = checkedOutHandle.doc()?.at?.[target];
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

  // Resolve (once, cached) whether a mounted doc is an app-global datatype we
  // exclude from the main-case membership. On failure we leave it unresolved,
  // so the doc stays visible — mirroring the overlay's "fall back to forking".
  function ensureSkipVerdict(url: AutomergeUrl): void {
    if (skipVerdicts.has(url)) return;
    void (async () => {
      try {
        const handle = await repo.find<HasDrafts>(url);
        if (disposed) return;
        const type = handle.doc()?.["@patchwork"]?.type;
        const skipped = type != null && SKIPPED_DATATYPES.has(type);
        if (skipVerdicts.get(url) === skipped) return;
        skipVerdicts.set(url, skipped);
        // A now-confirmed not-skipped doc may belong in the main draft.
        scheduleCloneSync();
        reconcile();
      } catch {
        // Leave unresolved: the doc keeps showing up, which is the safe default.
      }
    })();
  }

  // Resolve and start tracking the host doc's main draft, if any. Returns the
  // handle, or null when the host doc has no `mainDraftUrl` yet. Re-resolves
  // when the pointer changes and attaches `onTrackedChange` so the main draft's
  // `drafts` (tree shape) and `clones` (main membership) stay live.
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
    syncMainDraftClones();
    return handle;
  }

  // Mounts and skip verdicts arrive one doc at a time; batch them into a single
  // main-draft write (each write would otherwise rewalk and regroup).
  function scheduleCloneSync(): void {
    if (cloneSyncTimer !== null) return;
    cloneSyncTimer = setTimeout(() => {
      cloneSyncTimer = null;
      syncMainDraftClones();
    }, 0);
  }

  // Keep the main draft's identity clone map in step with the live mounted set
  // while the sidebar is open: every confirmed not-skipped mounted doc gets an
  // identity entry (`cloneUrl === url`, empty fork heads). Additive only —
  // entries are never removed, so main's membership (and history) is stable
  // across unmounts. Writes are diffed, so this is a no-op once everything
  // mounted is already recorded.
  function syncMainDraftClones(): void {
    if (disposed || !mainDraftHandle || listSubscribers.size === 0) return;
    const existing = mainDraftHandle.doc()?.clones ?? {};
    const toAdd = [...mountCounts.keys()].filter(
      (url) => skipVerdicts.get(url) === false && !existing[url]
    );
    if (toAdd.length === 0) return;
    mainDraftHandle.change((d) => {
      for (const url of toAdd) {
        if (!d.clones[url]) {
          d.clones[url] = { cloneUrl: url, clonedAt: EMPTY_HEADS };
        }
      }
    });
  }
};

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

// Project a clone map into member-doc entries, sorted by url so the positional
// equality checks below stay valid.
function clonesToMembers(
  clones: Record<AutomergeUrl, CloneEntry>
): DraftMemberDoc[] {
  return Object.entries(clones)
    .map(([url, entry]) => ({
      url: url as AutomergeUrl,
      cloneUrl: entry.cloneUrl,
      clonedAt: entry.clonedAt,
    }))
    .sort(byMemberUrl);
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
    a.changeGroupDocUrl === b.changeGroupDocUrl &&
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
