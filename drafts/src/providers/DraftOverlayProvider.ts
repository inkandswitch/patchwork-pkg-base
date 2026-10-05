import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";
import {
  accept,
  subscribe,
  type DocHandleDescriptor,
  type SubscribeEvent,
} from "@inkandswitch/patchwork-providers";

import type { CheckedOutDraft, DraftDoc } from "../draft-types.js";
import { canonicalUrl } from "../clone-policy.js";
import { forkMembers, loadLineage } from "../draft-forking.js";
import {
  trackMembership,
  type MembershipTracker,
} from "../draft-membership.js";

const HANDLE_DESCRIPTOR_SELECTOR = "repo:handle-descriptor";
const CHECKED_OUT_SELECTOR = "draft:checked-out";

// Remaps documents resolved beneath it onto per-draft clones, so edits stay
// inside the checked-out draft — and re-points *live* in place when the
// selection changes, without the host remounting anything.
//
// The host `<patchwork-view>` wraps tool document resolution in an
// `OverlayRepo` that opens a *streaming* `repo:handle-descriptor` subscription
// per document. This provider always claims those subscriptions (even while
// "main" is selected, where it answers a pass-through `{ url }`) and keeps the
// `respond` callbacks registered. It follows the selection itself via the
// ancestor draft-state provider's `draft:checked-out` doc: when
// `CheckedOutDraft.checkedOut` changes, every live subscription is re-answered
// with the new mapping — `{ url, cloneUrl }` for a member of the draft,
// `{ url }` on main or for a doc that isn't one — and the `OverlayRepo` swaps
// handle backings in place.
//
// Resolving a document never forks it. A draft's members are the docs
// reachable from the host doc (see draft-membership.ts), forked when the
// draft is created. While a draft is checked out this provider keeps that
// membership current: when a member's clone gains a link to a new doc, the
// new doc is forked and recorded in `DraftDoc.clones`, and every live
// subscription is re-answered. A request for a doc that isn't a member waits
// for any such pending re-walk before falling back to the original, so a doc
// linked a moment ago still resolves to its clone.
//
// Descriptors also honor the active checkpoint: `CheckedOutDraft.at` maps each
// member doc to per-doc `to`/`from` heads, and the `to` heads are baked onto
// the backing url (the clone on a draft, the original on main) so nested views
// freeze with the doc they live in; `OverlayRepo` honors heads on the backing
// url. Checkpoint moves (history scrubbing rewrites `at` without changing
// `checkedOut`) also re-answer every live subscription, so pins update by
// swapping backings in place — no remount. The fork point lives in
// `DraftDoc.clones[url].clonedAt`; the draft-state provider reads it to serve
// `draft:baseline`.
//
// A `url` attribute, when present, seeds the initial selection. That is how
// the chat preview iframe (see chat's `preview-frame.ts`) pins a
// self-bootstrapped overlay to a specific draft in a realm that has no
// draft-state provider to follow. The *current* selection is reflected onto the
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

  // The checked-out draft this overlay currently maps onto. Null = "main"
  // (pass-through descriptors, save for checkpoint pinning).
  let draftUrl: AutomergeUrl | null = null;
  type CheckedOut = {
    handle: DocHandle<DraftDoc>;
    membership: MembershipTracker;
    dispose(): void;
  };
  let draftReady: Promise<CheckedOut> | null = null;
  // Aborted and replaced on every descriptor refresh (draft re-point or
  // checkpoint move), and aborted on dispose, so in-flight resolutions from a
  // superseded state can detect they lost the race and stay silent. The
  // signal only gates `respond` — it is never passed into the resolution
  // work, which is shared across batches.
  let refresh = new AbortController();

  // Live `repo:handle-descriptor` subscriptions, kept so a re-point can push
  // fresh descriptors to every consumer.
  type DescriptorSubscriber = {
    original: AutomergeUrl;
    respond: (descriptor: DocHandleDescriptor) => void;
  };
  const descriptorSubscribers = new Set<DescriptorSubscriber>();

  // Seed the selection from the `url` attribute when present (the chat
  // preview iframe mounts us with a pinned draft and no draft-state provider).
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

  // Follow the selection: the ancestor draft-state provider serves the
  // ephemeral CheckedOutDraft doc url; we watch its `checkedOut` live. The
  // same doc carries the checkpoint (`at`), read at resolve time so
  // descriptors can pin a nested doc to its per-doc `to` heads — absent means
  // render live.
  //
  // A draft switch re-points via `applyDraft` (resets per-draft state); a
  // checkpoint-only move (scrubbing rewrites `at` while `checkedOut` stays
  // put) just re-answers live subscriptions with freshly pinned descriptors.
  let checkedOutHandle: DocHandle<CheckedOutDraft> | null = null;
  let checkpointSignature = JSON.stringify(null);
  const onCheckedOutChange = () => {
    const doc = checkedOutHandle?.doc();
    const nextDraft = doc?.checkedOut ?? null;
    const nextSignature = JSON.stringify(doc?.at ?? null);
    const checkpointMoved = nextSignature !== checkpointSignature;
    checkpointSignature = nextSignature;
    if (nextDraft !== draftUrl) {
      void applyDraft(nextDraft);
    } else if (checkpointMoved) {
      refreshDescriptors();
    }
  };
  const unsubscribeCheckedOut = subscribe<AutomergeUrl>(
    element,
    { type: CHECKED_OUT_SELECTOR },
    (url) => {
      if (disposed || !isValidAutomergeUrl(url)) return;
      void liveRepo.find<CheckedOutDraft>(url).then((handle) => {
        if (disposed || checkedOutHandle === handle) return;
        checkedOutHandle?.off("change", onCheckedOutChange);
        checkedOutHandle = handle;
        handle.on("change", onCheckedOutChange);
        onCheckedOutChange();
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
        const { signal } = refresh;
        void resolveDescriptor(original)
          .then((descriptor) => {
            // A re-point raced this resolution; `applyDraft`'s refresh pass
            // answers this subscriber with the new mapping instead.
            if (signal.aborted) return;
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
  };

  element.addEventListener("patchwork:subscribe", onSubscribe);
  return () => {
    disposed = true;
    refresh.abort();
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    unsubscribeCheckedOut();
    checkedOutHandle?.off("change", onCheckedOutChange);
    checkedOutHandle = null;
    descriptorSubscribers.clear();
    releaseDraft();
  };

  // Re-point the overlay at a new selection in place: reset the per-draft
  // state, then push fresh descriptors to every live subscriber.
  async function applyDraft(next: AutomergeUrl | null): Promise<void> {
    if (disposed) return;
    if (next === draftUrl) return;

    draftUrl = next;
    releaseDraft();

    // Reflect the selection for outside readers (e.g. the chat preview frame).
    // `draft-url` is not observed by <patchwork-view>, so this never remounts.
    element.setAttribute("draft-url", next ?? "");

    const ready = next ? checkOut(next) : null;
    draftReady = ready;
    ready?.then(
      (checkedOut) => {
        // Superseded (or disposed) while loading: nobody else will release it.
        if (draftReady !== ready) checkedOut.dispose();
      },
      (err) => {
        console.error(`[drafts] failed to load draft overlay for ${next}:`, err);
      }
    );

    refreshDescriptors();
  }

  // Load `url` and keep its membership current while it's checked out:
  // docs its clones newly link to are forked from the draft's lineage and
  // recorded, and live subscriptions are re-answered when the clone map grows.
  async function checkOut(url: AutomergeUrl): Promise<CheckedOut> {
    const handle = await liveRepo.find<DraftDoc>(url);
    const lineage = await loadLineage(liveRepo, handle.doc()?.parent ?? null);
    if (disposed) throw new Error("[drafts] provider disposed mid-load");

    const clones = () => handle.doc()?.clones ?? {};
    const membership = trackMembership({
      repo: liveRepo,
      roots: lineage.hostUrl ? [lineage.hostUrl] : [],
      known: Object.keys(clones()) as AutomergeUrl[],
      backingUrl: (original) => {
        const entry = clones()[original];
        return entry ? canonicalUrl(entry.cloneUrl) : lineage.source(original);
      },
      onAdded: async (urls) => {
        const unforked = urls.filter((original) => !clones()[original]);
        const forked = await forkMembers(liveRepo, unforked, lineage);
        if (Object.keys(forked).length === 0) return;
        handle.change((d) => {
          for (const [original, entry] of Object.entries(forked)) {
            const key = original as AutomergeUrl;
            if (!d.clones[key]) d.clones[key] = entry;
          }
        });
      },
    });

    let cloneCount = Object.keys(clones()).length;
    const onDraftChange = () => {
      const next = Object.keys(clones()).length;
      if (next === cloneCount) return;
      cloneCount = next;
      if (draftUrl === url) refreshDescriptors();
    };
    handle.on("change", onDraftChange);

    return {
      handle,
      membership,
      dispose() {
        handle.off("change", onDraftChange);
        membership.dispose();
      },
    };
  }

  function releaseDraft(): void {
    const previous = draftReady;
    draftReady = null;
    previous?.then(
      (checkedOut) => checkedOut.dispose(),
      () => {}
    );
  }

  // Re-answer every live descriptor subscription against the current
  // selection and checkpoint. Aborts the previous batch so slower, superseded
  // resolutions (including initial answers racing this refresh) stay silent.
  function refreshDescriptors(): void {
    refresh.abort();
    refresh = new AbortController();
    const { signal } = refresh;
    for (const subscriber of [...descriptorSubscribers]) {
      void resolveDescriptor(subscriber.original)
        .then((descriptor) => {
          if (signal.aborted) return;
          subscriber.respond(descriptor);
        })
        .catch((err) => {
          console.error(
            `[drafts] failed to re-map ${subscriber.original}:`,
            err
          );
        });
    }
  }

  // Resolve a `repo:handle-descriptor` request against the current selection.
  // The backing url is pinned to the active checkpoint's `to` heads for this
  // doc (if any) so nested views freeze with the doc they live in;
  // `OverlayRepo` honors heads on the backing url.
  //  - A member of the checked-out draft: its clone.
  //  - Anything else (main, contacts, docs the draft doesn't reach): the
  //    original, once any pending membership walk has had its say.
  async function resolveDescriptor(
    original: AutomergeUrl
  ): Promise<DocHandleDescriptor> {
    const to = checkedOutHandle?.doc()?.at?.[original]?.to ?? undefined;
    const cloneUrl = draftReady ? await cloneOf(draftReady, original) : null;
    if (!cloneUrl) {
      return to
        ? { url: original, cloneUrl: withHeads(original, to) }
        : { url: original };
    }
    return { url: original, cloneUrl: withHeads(cloneUrl, to) };
  }

  async function cloneOf(
    ready: Promise<CheckedOut>,
    original: AutomergeUrl
  ): Promise<AutomergeUrl | null> {
    const { handle, membership } = await ready;
    const recorded = () => handle.doc()?.clones?.[original]?.cloneUrl;
    if (!recorded()) await membership.settled();
    const cloneUrl = recorded();
    return cloneUrl ? canonicalUrl(cloneUrl) : null;
  }

  // Stamp `heads` onto `url` (same documentId), or return it unchanged when
  // there is no pin. Heads ride on the url so `OverlayRepo` resolves the doc at
  // that point in time.
  function withHeads(
    url: AutomergeUrl,
    heads: UrlHeads | undefined
  ): AutomergeUrl {
    if (!heads) return url;
    return stringifyAutomergeUrl({
      documentId: parseAutomergeUrl(url).documentId,
      heads,
    });
  }
};
