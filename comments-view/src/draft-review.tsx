// Reviewing the checked-out draft, from the comments panel.
//
// Approving a change is the same act as commenting on it — you looked, you
// formed a view, you said so — so the verdict lives with the conversation
// rather than on the draft card. The drafts panel still owns merging, and
// still refuses to merge a draft nothing currently approves; this is only
// where the verdict is given.
//
// Everything here reaches the drafts tool through the provider channel
// (`draft:list`, `draft:checked-out`) and through the repo. Nothing is
// imported from that package: if it isn't installed, the subscriptions go
// unanswered, `draft()` stays null, and the panel renders no review bar at
// all. The `DraftDoc` shape below is therefore a local restatement of the
// part of the schema this panel reads and writes, not a shared type.

// Pulls in <patchwork-view> JSX intrinsic type augmentations.
import type {} from "@inkandswitch/patchwork-elements";
import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js";
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo/slim";
import { subscribe, subscribeDoc } from "@inkandswitch/patchwork-providers-solid";

/** Heads as the drafts tool stores them — an opaque array of change hashes. */
type Heads = string[] & { __automergeUrlHeads?: unknown };

/** One person's verdict, keyed on the draft by their contact url. */
export type DraftReview = {
  state: "approved" | "rejected";
  at: number;
  /** The member heads the reviewer was shown; see `reviewCoversHeads`. */
  reviewedAt: Record<AutomergeUrl, Heads>;
};

type DraftMemberDoc = {
  url: AutomergeUrl;
  cloneUrl: AutomergeUrl | null;
  clonedAt: Heads | null;
};

type DraftSummary = {
  url: AutomergeUrl;
  name: string | null;
  members: DraftMemberDoc[];
  reviews: Record<AutomergeUrl, DraftReview> | null;
};

type DraftList = { main: DraftSummary; drafts: DraftSummary[] };

type DraftDoc = { reviews?: Record<AutomergeUrl, DraftReview> };

type CheckedOutDraft = { checkedOut: AutomergeUrl | null };

/** A stored review with who left it and whether it still stands. */
type ReviewEntry = {
  contactUrl: AutomergeUrl;
  review: DraftReview;
  isStale: boolean;
};

const EMPTY_LIST: DraftList = {
  main: { url: "" as AutomergeUrl, name: null, members: [], reviews: null },
  drafts: [],
};

/**
 * The review bar: this reviewer's verdict on the checked-out draft, and
 * everyone else's.
 *
 * Renders nothing at all on main, or when no drafts tool is answering — the
 * panel should look untouched wherever there is no draft to review.
 */
export function DraftReviewBar(props: {
  element: HTMLElement;
  repo: Repo;
  contactUrl: () => AutomergeUrl | undefined;
}) {
  const list = subscribe<DraftList>(
    props.element,
    { type: "draft:list" },
    EMPTY_LIST
  );
  const [checkedOut] = subscribeDoc<CheckedOutDraft>(props.element, {
    type: "draft:checked-out",
  });

  // The draft being reviewed: whichever one is checked out. `null` on main,
  // which is the thing drafts are reviewed against rather than a draft.
  const draft = createMemo<DraftSummary | null>(() => {
    const url = checkedOut()?.checkedOut ?? null;
    return url === null
      ? null
      : (list().drafts.find((summary) => summary.url === url) ?? null);
  });

  const cloneHeads = useCloneHeads(
    () => draft()?.members ?? [],
    () => props.repo
  );

  const reviews = createMemo<ReviewEntry[]>(() => {
    const stored = draft()?.reviews;
    if (!stored) return [];
    const heads = cloneHeads();
    // Until the members resolve there is nothing to measure against, so
    // every verdict reads as stale rather than as freshly given.
    const measured = Object.keys(heads).length > 0;
    return Object.entries(stored)
      .map(([contactUrl, review]) => ({
        contactUrl: contactUrl as AutomergeUrl,
        review,
        isStale: !measured || !reviewCoversHeads(review, heads),
      }))
      .sort((a, b) => b.review.at - a.review.at);
  });

  const myReview = createMemo<ReviewEntry | null>(() => {
    const mine = props.contactUrl();
    return reviews().find((entry) => entry.contactUrl === mine) ?? null;
  });
  const mine = () => myReview()?.review.state ?? null;

  // Record, or withdraw, this reviewer's verdict. The heads it was given are
  // pinned with it, so an approval of this draft can be told apart from an
  // approval of whatever the draft becomes later.
  const review = async (state: DraftReview["state"]) => {
    const target = draft();
    const contactUrl = props.contactUrl();
    if (!target || !contactUrl) return;
    const withdraw = mine() === state;
    const reviewedAt = cloneHeads();
    const handle = await props.repo.find<DraftDoc>(target.url);
    handle.change((d) => {
      if (withdraw) {
        if (d.reviews) delete d.reviews[contactUrl];
        return;
      }
      if (!d.reviews) d.reviews = {};
      // Copy the heads: they came off a live handle, and an Automerge value
      // must not be assigned into another document.
      const pinned: Record<AutomergeUrl, Heads> = {};
      for (const [url, heads] of Object.entries(reviewedAt)) {
        pinned[url as AutomergeUrl] = [...heads] as Heads;
      }
      d.reviews[contactUrl] = { state, at: Date.now(), reviewedAt: pinned };
    });
  };

  return (
    <Show when={draft()}>
      {(target) => (
        <div class="comments-review" data-verdict={mine() ?? undefined}>
          <div class="comments-review-head">
            <div class="comments-review-title">
              <span class="comments-review-eyebrow">Reviewing</span>
              <span class="comments-review-name">
                {target().name ?? "Draft"}
              </span>
            </div>
            <Show when={reviews().length > 0}>
              <div class="comments-review-chips">
                <For each={reviews()}>
                  {(entry) => <ReviewChip entry={entry} />}
                </For>
              </div>
            </Show>
          </div>
          <Show
            when={props.contactUrl()}
            fallback={
              <div class="comments-review-note">
                No contact — nobody to attribute a review to
              </div>
            }
          >
            <div class="comments-review-actions">
              <button
                type="button"
                class="comments-review-action"
                data-state="approved"
                data-active={mine() === "approved" ? "" : undefined}
                title={
                  mine() === "approved"
                    ? "Withdraw your approval"
                    : "Approve these changes, letting the draft be merged"
                }
                onClick={() => void review("approved")}
              >
                <TickIcon />
                {mine() === "approved" ? "Approved" : "Approve"}
              </button>
              <button
                type="button"
                class="comments-review-action"
                data-state="rejected"
                data-active={mine() === "rejected" ? "" : undefined}
                title={
                  mine() === "rejected"
                    ? "Withdraw your rejection"
                    : "Reject these changes — recorded here, but it doesn't block a merge"
                }
                onClick={() => void review("rejected")}
              >
                <CrossIcon />
                {mine() === "rejected" ? "Rejected" : "Reject"}
              </button>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

/**
 * One person's verdict: their avatar, with the verdict as a badge on its
 * corner. A stale one is dimmed — they looked, but not at this version.
 */
function ReviewChip(props: { entry: ReviewEntry }) {
  const approved = () => props.entry.review.state === "approved";
  return (
    <span
      class="comments-review-chip"
      data-state={props.entry.review.state}
      data-stale={props.entry.isStale ? "" : undefined}
      title={
        (approved() ? "Approved" : "Rejected") +
        (props.entry.isStale
          ? " — the draft has changed since, so this no longer counts"
          : "")
      }
    >
      <span class="comments-review-avatar">
        <patchwork-view
          doc-url={props.entry.contactUrl}
          tool-id="contact-inline"
        />
      </span>
      <span class="comments-review-chip-mark">
        {approved() ? <TickIcon /> : <CrossIcon />}
      </span>
    </span>
  );
}

function TickIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * The live heads of the draft's member docs — what a review is measured
 * against. A review pins the heads it was shown; anything landing afterwards
 * moves these and the review goes stale.
 */
function useCloneHeads(
  members: () => DraftMemberDoc[],
  repo: () => Repo
): () => Record<AutomergeUrl, Heads> {
  const [heads, setHeads] = createSignal<Record<AutomergeUrl, Heads>>({});
  createEffect(() => {
    const current = members();
    setHeads({});
    if (current.length === 0) return;
    let cancelled = false;
    const stopWatching: (() => void)[] = [];
    onCleanup(() => {
      cancelled = true;
      for (const stop of stopWatching) stop();
    });
    void (async () => {
      for (const member of current) {
        let handle: DocHandle<unknown>;
        try {
          handle = await repo().find<unknown>(member.cloneUrl ?? member.url);
        } catch {
          continue; // An unresolvable member can't retract anyone's approval.
        }
        if (cancelled) return;
        const read = () =>
          setHeads((prev) => ({ ...prev, [member.url]: handle.heads() }));
        read();
        handle.on("change", read);
        stopWatching.push(() => handle.off("change", read));
      }
    })();
  });
  return heads;
}

/**
 * Whether a review still covers the draft as it is now: every member doc has
 * to sit exactly where the reviewer left it.
 *
 * A member the review says nothing about counts as changed — that is a doc
 * added to the draft afterwards, which is new content nobody has seen.
 */
function reviewCoversHeads(
  review: DraftReview,
  heads: Record<AutomergeUrl, Heads>
): boolean {
  return Object.entries(heads).every(([url, current]) => {
    const seen = review.reviewedAt[url as AutomergeUrl];
    if (!seen || seen.length !== current.length) return false;
    const set = new Set(current);
    return seen.every((hash) => set.has(hash));
  });
}
