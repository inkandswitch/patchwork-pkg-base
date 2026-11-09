import type { AutomergeUrl, UrlHeads } from "@automerge/automerge-repo/slim";

// A draft's version of one doc. Forking records where the draft branches
// off — `source` (the parent draft's clone; absent for the original) at
// `clonedAt` — and the draft reads that snapshot until its first write
// clones it there into `cloneUrl`. A doc created on the draft is its own
// clone (`cloneUrl` the doc itself, `clonedAt` empty). `mergedAt` is the
// target's heads after the clone merged back.
export type CloneEntry = {
  source?: AutomergeUrl;
  clonedAt: UrlHeads;
  cloneUrl?: AutomergeUrl;
  mergedAt?: UrlHeads;
};

// `parent` points at the URL this draft branches off of: the main draft (for
// top-level drafts, listed in `mainDraft.drafts`) or another `DraftDoc` (for
// sub-drafts attached via `DraftDoc.drafts`).
//
// `isMain` marks the single "main draft" a host doc points at via
// `@patchwork.mainDraftUrl`. The main draft is bookkeeping only: it is never
// resolved through (the overlay stays a no-op for main), and its `drafts`
// holds the user-visible top-level draft list. Its `clones` are unused (older
// builds kept identity mappings there).
//
// `mergedAt` is a wall-clock timestamp set when the draft is merged into
// its parent; absent means "still open". The sidebar uses it to filter
// merged drafts out of the list.
//
// `name` is the user-given display name; absent means the default label
// ("Draft", or "Main" for the main draft). Renaming main is what creates the
// main draft doc if it doesn't exist yet.
export type DraftDoc = {
  "@patchwork": { type: "draft" };
  isMain?: boolean;
  name?: string;
  parent: AutomergeUrl;
  drafts: AutomergeUrl[];
  clones: Record<AutomergeUrl, CloneEntry>;
  mergedAt?: number;
  // Main draft only: points at the host doc's ActorAttributionDoc, mapping
  // actor ids to contact urls for author display. Stamped by the list
  // provider alongside the eager main-draft creation.
  actorAttributionUrl?: AutomergeUrl;
  // Main draft only: monotonic counter behind new forks' default names
  // ("Draft N"). Never decremented, so numbers aren't reused after deletes.
  draftCounter?: number;
};

// Maps Automerge actor ids to the contact doc of the user who wrote with
// them. An actor id is per doc instance per session, so one person
// accumulates many — the map is many-to-one and only the writing client can
// attribute its own ids, which it does as it makes local changes (see
// actor-attribution.ts). One doc per host doc (actor ids span main and every
// draft), stamped on the main draft via `actorAttributionUrl`. Keyed by
// actor id so concurrent writers converge per-entry.
export type ActorAttributionDoc = {
  "@patchwork": { type: "actor-attribution" };
  actors: Record<string, AutomergeUrl>;
};

// One burst of activity in a draft's timeline: consecutive changes
// (interleaved across the draft's member docs and their actors) separated by
// no more than the timeline gap, aggregated down to what a timeline row
// renders. Stitched from each member's history groups (see timeline.ts).
export type ChangeGroup = {
  id: string; // `tg-${newestHash}` — stable group identity
  startTime: number; // span covered, seconds (automerge change time)
  endTime: number;
  // Anchor change (click-to-pin, drag-to-fork): which MEMBER doc owns the
  // group's newest change, and its hash. Varies per group — a burst's last
  // edit can land in any member (host doc or embedded doc).
  newestMemberUrl: AutomergeUrl;
  newestHash: string;
  actors: string[]; // deduped authors, newest contributor first
  memberUrls: AutomergeUrl[]; // the member docs the span edited, most recently edited first
  additions: number; // summed across ALL member docs in the span
  deletions: number;
  changeCount: number; // for scrubber band geometry
};

// One member doc's pinned view within a checkpoint. `to` is the heads to render
// the doc at (a fixed-heads, read-only view); omit it to leave the doc live.
// `from` is the diff baseline the consumer compares `to` (or live) against;
// omit it for no diff. `from` without `to` is the live-with-diff state (the
// sidebar's eye toggled on while nothing is pinned: the doc stays writable and
// diffs against its fork point). A `from` of `[]` diffs against the empty doc,
// so the whole doc reads as added.
export type DocCheckpoint = {
  from?: UrlHeads;
  to?: UrlHeads;
};

// A frozen, read-only view of a draft (or main) at a point in its history: maps
// each member doc's original url to the heads to view it at (`to`) and to diff
// against (`from`). The selection's `checkedOut` branch gives those heads their
// meaning, since post-fork changes only exist in that branch's clone.
//
// Built from a clicked timeline entry: the clicked doc is pinned exactly to that
// change, every other member to its latest change at or before the entry's time
// (approximate but good enough). Docs with no change at or before that time are
// absent from the map — they didn't exist yet, so they fall through to live.
export type DraftCheckpoint = Record<AutomergeUrl, DocCheckpoint>;

// What the draft provider has checked out, answered for `draft:selection` and
// set with `draft:select`. In memory only: the `draft=` URL parameter carries
// `checkedOut` across reloads, `at` is never stored. `checkedOut = null`
// means main, the root itself.
//
// `at` is the checkpoint (see DraftCheckpoint): per-doc pinned heads (`to`)
// and/or diff baselines (`from`). Null means the live latest heads with no
// diff. Entries with only `from` leave the docs live but diffing — the
// sidebar's eye toggle on an unpinned draft.
export type DraftSelection = {
  checkedOut: AutomergeUrl | null;
  at: DraftCheckpoint | null;
};

// What a draft overlay answers for `draft:changes`: how its root's docs
// differ between each doc's diff baseline (`from`) and the version shown
// (`to`, or live), per the checkpoint. Empty while no doc has a baseline.
//   - `changed`: docs added to a folder (or created) and docs whose content
//     changed, by url.
//   - `removed`: per folder url, the entries it had at its baseline and no
//     longer has.
//   - `containing`: folders with a change somewhere beneath them.
export type DraftChanges = {
  changed: Record<AutomergeUrl, DocChange>;
  removed: Record<AutomergeUrl, RemovedEntry[]>;
  containing: AutomergeUrl[];
};

export type DocChange = "added" | "modified";

// A folder entry that's gone since the folder's baseline.
//   - `url`: the doc, pinned to the heads it's at now (opens read-only).
//   - `folder`: the folder, pinned to its baseline, where it still lists it.
//   - `after`: the entry it followed that's still there, or null for the top.
export type RemovedEntry = {
  url: AutomergeUrl;
  name: string;
  type: string;
  folder: AutomergeUrl;
  after: AutomergeUrl | null;
};

// Answered for `draft:status`. `verifying` while a `draft=` from the URL
// hasn't been confirmed as a live draft of the root yet (documents wait),
// `unavailable` once that has taken too long, `ready` once a selection holds.
export type DraftStatus = "verifying" | "ready" | "unavailable";

// Response shape for `draft:baseline { url }`, served by the draft provider
// (see `currentBaseline`). `heads` is the doc's diff baseline: the checkpoint's
// per-doc `from`, written by the sidebar's eye toggle and scrubber. `heads` is
// `null` when the checkpoint has no entry for the doc or the entry carries no
// `from` — there is no implicit fork-point fallback; no baseline means no diff.
// It is `null` rather than optional so the value is a valid structured-cloneable
// `JSONValue` crossing the provider channel.
export type Baseline = {
  heads: UrlHeads | null;
};

// One document that makes up a draft (or main), nested inside `DraftSummary`.
//
// On a draft these are the docs the draft has cloned — `cloneUrl` is the
// per-draft clone and `clonedAt` its fork point (mirrors `CloneEntry`). On
// "main" they are every doc in the root's tree, with both fields `null`. Like
// `Baseline`, the nullable fields use `null` rather than optional so the value
// stays a valid structured-cloneable `JSONValue` crossing the provider
// channel.
export type DraftMemberDoc = {
  url: AutomergeUrl;
  cloneUrl: AutomergeUrl | null;
  clonedAt: UrlHeads | null;
};

// One entry in the read-only `draft:list` push: a draft (or main) together
// with the member docs that make it up, so a consumer can render a card and
// its change timeline without loading the `DraftDoc` itself.
export type DraftSummary = {
  // The `DraftDoc` url for a real draft; the host/main-draft url for `main`.
  url: AutomergeUrl;
  // What this draft was forked off (`DraftDoc.parent`): the main draft's url
  // for a top-level draft, another draft's url for a sub-fork. `null` on the
  // main entry itself. The sidebar uses it to place the merge button on the
  // parent's card and to indent nested cards.
  parent: AutomergeUrl | null;
  members: DraftMemberDoc[];
  // Number of sub-drafts (`DraftDoc.drafts.length`), shown in the card meta.
  childCount: number;
  // User-given display name (`DraftDoc.name`); `null` (not optional, to stay
  // structured-cloneable) means unnamed — the card shows its default label.
  name: string | null;
};

// Response shape for `draft:list`: the host doc's `main` entry plus the flat,
// tree-ordered list of its (non-merged) drafts. Read-only and recomputed by
// the provider; selection lives separately in `DraftSelection`.
export type DraftList = {
  main: DraftSummary;
  drafts: DraftSummary[];
  // The host doc's ActorAttributionDoc url (`mainDraft.actorAttributionUrl`);
  // `null` until stamped. The sidebar resolves timeline actors to contacts
  // through it.
  actorAttributionUrl: AutomergeUrl | null;
};

// Convention: a document that has been drafted carries `@patchwork.mainDraftUrl`
// pointing at its single "main draft" — a `DraftDoc` (with `isMain`) whose
// `drafts` lists the top-level drafts that branch off of it. The pointer is
// created lazily on the first draft, so it is absent until then.
//
// `workspace` marks a folder whose drafts cover everything beneath it (see
// WorkspaceProvider). It is stamped when the folder is first drafted, not
// when the main draft is created — older builds created main drafts for every
// doc the sidebar looked at, so `mainDraftUrl` alone doesn't mean "drafted".
export type HasDrafts = {
  "@patchwork"?: {
    type?: string;
    mainDraftUrl?: AutomergeUrl;
    workspace?: boolean;
  };
};

export function isDraftDoc(value: unknown): value is DraftDoc {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const marker = v["@patchwork"] as { type?: string } | undefined;
  return marker?.type === "draft" && !!v.clones && typeof v.clones === "object";
}
