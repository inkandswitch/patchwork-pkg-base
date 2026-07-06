import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import {
  accept,
  subscribe,
  type DocHandleDescriptor,
  type SubscribeEvent,
} from "@inkandswitch/patchwork-providers";

import type { Baseline, DraftDoc, DraftsState } from "../draft-types.js";

const HANDLE_DESCRIPTOR_SELECTOR = "repo:handle-descriptor";
const BASELINE_SELECTOR = "draft:baseline";
const DRAFT_LIST_SELECTOR = "draft:list";

// HACK: datatypes the draft overlay must never clone into a draft.
//
// The overlay forks *every* document resolved beneath it so edits stay scoped
// to the draft. But some docs pulled through the overlay are app-global rather
// than part of the document being drafted: the account doc (read by the context
// sidebar, which renders inside the overlay) and contact docs (resolved per
// comment author). Forking those branches global state — account config, user
// profiles — into a draft, which is wrong and could even merge back into main.
//
// The principled fix is to know which documents actually belong to the draft
// and fork only those — the overlay shouldn't clone a doc just because it was
// resolved beneath it. Until we have that notion of draft membership we invert
// the problem with a blunt skip-list: it bakes app-level datatype names into
// the otherwise-generic overlay and relies on each doc carrying a matching
// `@patchwork.type`.
const SKIPPED_DATATYPES: ReadonlySet<string> = new Set([
  "account",
  "contact",
  "draft",
]);

// Remaps documents resolved beneath it onto per-draft clones, so edits stay
// inside the selected draft — and re-points *live* in place when the selection
// changes, without the host remounting anything.
//
// The host `<patchwork-view>` wraps tool document resolution in an
// `OverlayRepo` that opens a *streaming* `repo:handle-descriptor` subscription
// per document. This provider always claims those subscriptions (even while
// "main" is selected, where it answers a pass-through `{ url }`) and keeps the
// `respond` callbacks registered. It follows the selected draft itself via the
// ancestor draft-list provider's `draft:list` state doc: when
// `DraftsState.selectedDraft` changes, every live subscription is re-answered
// with the new mapping — `{ url, cloneUrl }` on a draft (the clone is forked
// eagerly on first resolution and recorded in `DraftDoc.clones`), `{ url }` on
// main — and the `OverlayRepo` swaps handle backings in place.
//
// The fork point is published as `draft:baseline { heads }` (also streaming;
// re-notified on every re-point) so consumers can render a diff against the
// pre-draft state.
//
// A `url` attribute, when present, seeds the initial selection. That is how
// the chat preview iframe (see chat's `preview-frame.ts`) pins a
// self-bootstrapped overlay to a specific draft in a realm that has no
// draft-list provider to follow. The *current* selection is reflected onto the
// (un-observed, so remount-free) `draft-url` attribute for outside readers.
export const DraftOverlayProvider = (element: HTMLElement) => {
  const repo = "repo" in window ? window.repo : undefined;
  if (!repo) {
    console.warn(
      "[drafts] window.repo is not set; draft overlay provider disabled"
    );
    return () => {};
  }
  const liveRepo = repo;

  let disposed = false;

  // The selected draft this overlay currently maps onto. Null = "main"
  // (pass-through descriptors, null baselines).
  let draftUrl: AutomergeUrl | null = null;
  let draftHandle: DocHandle<DraftDoc> | null = null;
  let draftReady: Promise<DocHandle<DraftDoc>> | null = null;
  // Bumped on every re-point so in-flight resolutions from a superseded
  // selection can detect they lost the race and stay silent.
  let switchEpoch = 0;

  // One eager-clone resolution per original url; de-dupes concurrent requests.
  // Cleared on re-point (it is per-draft state).
  const cloneResolutions = new Map<AutomergeUrl, Promise<AutomergeUrl>>();

  // Live `repo:handle-descriptor` subscriptions, kept so a re-point can push
  // fresh descriptors to every consumer.
  type DescriptorSubscriber = {
    original: AutomergeUrl;
    respond: (descriptor: DocHandleDescriptor) => void;
  };
  const descriptorSubscribers = new Set<DescriptorSubscriber>();

  // `draft:baseline` subscribers keyed by the canonical target url.
  const baselineSubscribers = new Map<
    AutomergeUrl,
    Set<(baseline: Baseline) => void>
  >();

  // Seed the selection from the `url` attribute when present (the chat
  // preview iframe mounts us with a pinned draft and no draft-list provider).
  const rawSeed = element.getAttribute("url");
  if (rawSeed) {
    if (isValidAutomergeUrl(rawSeed)) {
      void applyDraft(rawSeed);
    } else {
      console.warn(
        `[drafts] <patchwork-view component="patchwork-draft-overlay-provider"> ` +
          `has an invalid url attribute (got ${JSON.stringify(rawSeed)})`
      );
    }
  }

  // Follow the selection: the ancestor draft-list provider serves the
  // ephemeral DraftsState doc url; we watch its `selectedDraft` live.
  let draftsStateHandle: DocHandle<DraftsState> | null = null;
  const onDraftsStateChange = () => {
    void applyDraft(draftsStateHandle?.doc()?.selectedDraft ?? null);
  };
  const unsubscribeDraftList = subscribe<AutomergeUrl>(
    element,
    { type: DRAFT_LIST_SELECTOR },
    (url) => {
      if (disposed || !isValidAutomergeUrl(url)) return;
      void liveRepo.find<DraftsState>(url).then((handle) => {
        if (disposed || draftsStateHandle === handle) return;
        draftsStateHandle?.off("change", onDraftsStateChange);
        draftsStateHandle = handle;
        handle.on("change", onDraftsStateChange);
        onDraftsStateChange();
      });
    }
  );

  const onSubscribe = (event: SubscribeEvent) => {
    const selector = event.detail.selector;

    if (selector.type === HANDLE_DESCRIPTOR_SELECTOR) {
      const rawTarget = selector.url;
      if (typeof rawTarget !== "string" || !isValidAutomergeUrl(rawTarget)) {
        return;
      }
      const original = canonicalUrl(rawTarget);
      accept<DocHandleDescriptor>(event, (respond) => {
        const subscriber: DescriptorSubscriber = { original, respond };
        descriptorSubscribers.add(subscriber);
        const epoch = switchEpoch;
        void resolveDescriptor(original)
          .then((descriptor) => {
            // A re-point raced this resolution; `applyDraft`'s refresh pass
            // answers this subscriber with the new mapping instead.
            if (disposed || epoch !== switchEpoch) return;
            respond(descriptor);
          })
          .catch((err) => {
            console.error(`[drafts] failed to resolve ${original}:`, err);
          });
        return () => {
          descriptorSubscribers.delete(subscriber);
        };
      });
      return;
    }

    if (selector.type === BASELINE_SELECTOR) {
      const rawTarget = selector.url;
      if (typeof rawTarget !== "string" || !isValidAutomergeUrl(rawTarget)) {
        return;
      }
      const target = canonicalUrl(rawTarget);
      accept<Baseline>(event, (respond) => {
        const ready = draftReady;
        if (ready) {
          const epoch = switchEpoch;
          void ready.then(() => {
            if (disposed || epoch !== switchEpoch) return;
            respond(currentBaseline(target));
          });
        } else {
          respond(currentBaseline(target));
        }
        let set = baselineSubscribers.get(target);
        if (!set) baselineSubscribers.set(target, (set = new Set()));
        set.add(respond);
        return () => {
          set!.delete(respond);
          if (set!.size === 0) baselineSubscribers.delete(target);
        };
      });
      return;
    }
  };

  element.addEventListener("patchwork:subscribe", onSubscribe);
  return () => {
    disposed = true;
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    unsubscribeDraftList();
    draftsStateHandle?.off("change", onDraftsStateChange);
    draftsStateHandle = null;
    descriptorSubscribers.clear();
    baselineSubscribers.clear();
    cloneResolutions.clear();
  };

  // Re-point the overlay at a new selection in place: reset the per-draft
  // state, then push fresh descriptors and baselines to every live subscriber.
  async function applyDraft(next: AutomergeUrl | null): Promise<void> {
    if (disposed) return;
    if (next === draftUrl) return;

    draftUrl = next;
    draftHandle = null;
    const epoch = ++switchEpoch;
    cloneResolutions.clear();

    // Reflect the selection for outside readers (e.g. the chat preview frame).
    // `draft-url` is not observed by <patchwork-view>, so this never remounts.
    element.setAttribute("draft-url", next ?? "");

    draftReady = next
      ? (async () => {
          const handle = await liveRepo.find<DraftDoc>(next);
          if (disposed) {
            throw new Error("[drafts] provider disposed mid-load");
          }
          if (epoch === switchEpoch) draftHandle = handle;
          return handle;
        })()
      : null;
    draftReady?.catch((err) => {
      console.error(`[drafts] failed to load draft overlay for ${next}:`, err);
    });

    // Re-answer every live descriptor subscription against the new selection.
    // Each resolution is epoch-guarded so a rapid follow-up switch wins.
    for (const subscriber of [...descriptorSubscribers]) {
      void resolveDescriptor(subscriber.original)
        .then((descriptor) => {
          if (disposed || epoch !== switchEpoch) return;
          subscriber.respond(descriptor);
        })
        .catch((err) => {
          console.error(
            `[drafts] failed to re-map ${subscriber.original}:`,
            err
          );
        });
    }

    // Baselines flip wholesale on re-point: null on main, the recorded fork
    // point (or null until first clone) on a draft.
    if (draftReady) await draftReady.catch(() => {});
    if (disposed || epoch !== switchEpoch) return;
    for (const [target, set] of baselineSubscribers) {
      const baseline = currentBaseline(target);
      for (const respond of [...set]) respond(baseline);
    }
  }

  // Resolve a `repo:handle-descriptor` request against the current selection:
  // on main everything passes through un-remapped; on a draft, skipped docs
  // (account, contacts) resolve straight to the real doc (no `cloneUrl` -> no
  // fork) and everything else is forked into the draft via `resolveClone`.
  async function resolveDescriptor(
    original: AutomergeUrl
  ): Promise<DocHandleDescriptor> {
    if (!draftUrl) return { url: original };
    if (await isSkippedDoc(original)) return { url: original };
    const cloneUrl = await resolveClone(original);
    return { url: original, cloneUrl };
  }

  // A doc is skipped when its `@patchwork.type` is in `SKIPPED_DATATYPES`. On
  // any failure we fall back to cloning (the existing behaviour), which is the
  // safe default — a doc that should be skipped merely keeps forking, it isn't
  // lost.
  async function isSkippedDoc(original: AutomergeUrl): Promise<boolean> {
    try {
      const handle = await liveRepo.find<{ "@patchwork"?: { type?: string } }>(
        original
      );
      const type = handle.doc()?.["@patchwork"]?.type;
      return type != null && SKIPPED_DATATYPES.has(type);
    } catch {
      return false;
    }
  }

  // Ensure a clone of `original` exists for the current draft and return its
  // url. Reuses an existing clone recorded in `DraftDoc.clones`; otherwise
  // forks `original` at its current heads and records the fork point so the
  // baseline and merge-back can find it.
  function resolveClone(original: AutomergeUrl): Promise<AutomergeUrl> {
    const cached = cloneResolutions.get(original);
    if (cached) return cached;
    const ready = draftReady;
    const epoch = switchEpoch;
    const promise = (async () => {
      if (!ready) {
        throw new Error("[drafts] resolveClone called without a draft");
      }
      const handle = await ready;
      const existing = handle.doc()?.clones?.[original];
      if (existing) return canonicalUrl(existing.cloneUrl);

      const originalHandle = await liveRepo.find<unknown>(original);
      const clonedAt = originalHandle.heads();
      const clone = liveRepo.clone(originalHandle);
      const cloneUrl = canonicalUrl(clone.url);

      handle.change((d) => {
        d.clones[original] = { cloneUrl, clonedAt };
      });

      if (!disposed && epoch === switchEpoch) notifyBaseline(original);
      return cloneUrl;
    })();
    cloneResolutions.set(original, promise);
    return promise;
  }

  function currentBaseline(target: AutomergeUrl): Baseline {
    const heads = draftHandle?.doc()?.clones?.[target]?.clonedAt;
    return { heads: heads ?? null };
  }

  function notifyBaseline(target: AutomergeUrl): void {
    const set = baselineSubscribers.get(target);
    if (!set) return;
    const baseline = currentBaseline(target);
    for (const respond of [...set]) respond(baseline);
  }
};

function canonicalUrl(url: AutomergeUrl): AutomergeUrl {
  const { documentId } = parseAutomergeUrl(url);
  return stringifyAutomergeUrl({ documentId });
}
