import {
  decodeHeads,
  encodeHeads,
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type DocHandleChangePayload,
  type Repo,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";
import * as Automerge from "@automerge/automerge/slim";

import type {
  AgentTag,
  ChangeGroup,
  ChangeGroupDoc,
  DraftDoc,
  DraftMemberDoc,
} from "./draft-types.js";
import { partitionRows, type MergedDraftSpec } from "./merge-attribution.js";

// Bump to discard every existing group doc's contents (they self-rebuild).
export const CHANGE_GROUP_DOC_VERSION = 3;

// A pause between consecutive changes longer than this starts a new group:
// bursts of continuous editing read as a single row, however long they run,
// and any ten-minute-plus lull splits the timeline. Baked into the group
// doc — changing it invalidates and rebuilds every document.
export const INACTIVITY_GAP_MS = 10 * 60 * 1000;

// How long grouping may hold the main thread before yielding to idle time.
const SLICE_BUDGET_MS = 8;

// Coalesce bursts of member-doc change events into one grouping update.
const GROUPING_DEBOUNCE_MS = 250;

// Change-event sources that mean a LOCAL edit (made through this client's
// doc instance), as opposed to synced/merged remote changes.
const LOCAL_PATCH_SOURCES = new Set(["change", "changeAt", "emptyChange"]);

// One timeline the ChangeGrouper is responsible for: the DraftDoc that owns it
// (main included — the main draft is always real), the member docs whose
// interleaved changes make it up, and the host doc whose creation time is
// the "before this document existed" cutoff.
export type TimelineGroupingSpec = {
  draftHandle: DocHandle<DraftDoc>;
  members: DraftMemberDoc[];
  rootDocUrl: AutomergeUrl;
  // Drafts merged into this timeline (`DraftDoc.mergedInto` points here),
  // with the head ranges their contributions span. Each one's changes are
  // pulled out of the inactivity-gap grouping into one dedicated group.
  mergedDrafts: MergedDraftSpec[];
};

export type ChangeGrouper = {
  // Reconcile the timelines to keep grouped (ordered by priority). Attaches
  // member-doc change listeners that drive incremental grouping updates;
  // timelines absent from the list are torn down.
  setTimelines: (specs: TimelineGroupingSpec[]) => void;
  dispose: () => void;
};

export type ChangeGrouperOptions = {
  // Called when a watched member doc receives a local change — i.e. the
  // current user just wrote with that doc instance's actor id. Feeds the
  // ActorRecorder (see actor-attribution.ts).
  onLocalChange?: (doc: Automerge.Doc<unknown>) => void;
  // The contact a raw actor id is attributed to (the shared
  // ActorAttributionDoc), or null while unknown. Contributor keys resolve
  // through this so one person's many actor ids (per doc, per session) read
  // as one contributor instead of splitting groups at every actor change.
  resolveContact?: (actorId: string) => AutomergeUrl | null;
};

// Resolve a draft's change-group doc, creating it and stamping
// `changeGroupDocUrl` the first time. A document whose format version or
// grouping parameter no longer matches is emptied in place and rebuilt.
export async function ensureChangeGroupDoc(
  repo: Repo,
  draftHandle: DocHandle<DraftDoc>
): Promise<DocHandle<ChangeGroupDoc>> {
  const draft = draftHandle.doc();
  const existingUrl = getChangeGroupDocUrl(draft);
  if (existingUrl && isValidAutomergeUrl(existingUrl)) {
    const handle = await repo.find<ChangeGroupDoc>(existingUrl);
    const doc = handle.doc();
    if (
      doc &&
      (doc.version !== CHANGE_GROUP_DOC_VERSION ||
        doc.inactivityGapMs !== INACTIVITY_GAP_MS)
    ) {
      handle.change((d) => {
        d.version = CHANGE_GROUP_DOC_VERSION;
        d.inactivityGapMs = INACTIVITY_GAP_MS;
        d.groups = {};
        d.computedThrough = {};
      });
    }
    if (!draft?.changeGroupDocUrl) {
      draftHandle.change((d) => {
        if (!d.changeGroupDocUrl) d.changeGroupDocUrl = existingUrl;
      });
    }
    return handle;
  }

  const changeGroupHandle = repo.create<ChangeGroupDoc>({
    "@patchwork": { type: "change-group" },
    version: CHANGE_GROUP_DOC_VERSION,
    inactivityGapMs: INACTIVITY_GAP_MS,
    groups: {},
    computedThrough: {},
  });
  draftHandle.change((d) => {
    if (!d.changeGroupDocUrl) d.changeGroupDocUrl = changeGroupHandle.url;
  });
  // A concurrent creator may have won the stamp; honor whichever pointer
  // settled (our fresh doc is then an accepted orphan, same as mainDraftUrl).
  const settled = draftHandle.doc()?.changeGroupDocUrl;
  if (
    settled &&
    settled !== changeGroupHandle.url &&
    isValidAutomergeUrl(settled)
  ) {
    return repo.find<ChangeGroupDoc>(settled);
  }
  return changeGroupHandle;
}

function getChangeGroupDocUrl(
  draft: DraftDoc | undefined
): AutomergeUrl | undefined {
  const legacyDraft = draft as
    | (DraftDoc & { changeGroupCacheUrl?: AutomergeUrl })
    | undefined;
  return draft?.changeGroupDocUrl ?? legacyDraft?.changeGroupCacheUrl;
}

// Work out one change's rough edit magnitude by diffing it against its parents
// and counting its patches: splice lengths and insert counts as additions, del
// lengths as deletions, everything else (put / inc / mark / …) as one addition.
// `@patchwork` metadata paths are ignored. A pure function of immutable
// history, so each change is diffed once, here, and only the group aggregates
// are kept.
export function computeEditCounts(
  doc: Automerge.Doc<unknown>,
  hash: string,
  deps: string[]
): { additions: number; deletions: number } {
  try {
    return countPatches(
      Automerge.diff(
        doc,
        deps as unknown as Automerge.Heads,
        [hash] as unknown as Automerge.Heads
      )
    );
  } catch (err) {
    console.warn("[drafts] failed to diff change for edit counts:", hash, err);
    return { additions: 0, deletions: 0 };
  }
}

// The same +/- magnitude over an arbitrary head range (`from` → `to`), e.g.
// the eye's diff span between the baseline and the scrubbed head.
export function computeRangeEditCounts(
  doc: Automerge.Doc<unknown>,
  from: string[],
  to: string[]
): { additions: number; deletions: number } {
  try {
    return countPatches(
      Automerge.diff(
        doc,
        from as unknown as Automerge.Heads,
        to as unknown as Automerge.Heads
      )
    );
  } catch (err) {
    console.warn("[drafts] failed to diff range for edit counts:", err);
    return { additions: 0, deletions: 0 };
  }
}

// Shared patch-counting rules for the two diff flavors above.
function countPatches(patches: Automerge.Patch[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const patch of patches) {
    // Comment writes are surfaced as their own timeline entries (and split
    // groups), so they don't count as edits either.
    if (patch.path[0] === "@patchwork" || patch.path[0] === "@comments")
      continue;
    if (patch.action === "splice") {
      additions += (patch.value as string).length;
    } else if (patch.action === "insert") {
      additions += Array.isArray((patch as { values?: unknown[] }).values)
        ? (patch as { values: unknown[] }).values.length
        : 1;
    } else if (patch.action === "del") {
      deletions += (patch as { length?: number }).length ?? 1;
    } else {
      additions += 1;
    }
  }
  return { additions, deletions };
}

// When was a document created, as a Unix SECONDS timestamp? Reads the doc's
// full history and returns its first change's time (the creation change).
// Returns undefined when the doc, its history, or that time can't be resolved,
// in which case callers skip the "before creation" filter rather than hiding
// everything.
export async function getDocCreationTime(
  repo: Repo,
  url: AutomergeUrl | undefined
): Promise<number | undefined> {
  if (!url) return undefined;
  try {
    const handle = await repo.find<unknown>(url);
    const doc = handle.doc();
    if (!doc) return undefined;
    const metas = Automerge.getChangesMetaSince(doc, []);
    return metas[0]?.time || undefined;
  } catch (err) {
    console.warn("[drafts] failed to resolve creation time for:", url, err);
    return undefined;
  }
}

// One member change awaiting aggregation. `seq` is the change's index within
// its member's gathered metas, used only to break same-second timestamp ties
// (meta.time is second-resolution) with the doc's own causal order.
type PendingChange = {
  memberUrl: AutomergeUrl;
  doc: Automerge.Doc<unknown>;
  hash: string;
  deps: string[];
  time: number;
  actor: string;
  seq: number;
  agent?: AgentTag;
};

// Read an agent tag out of an Automerge change message. The chat tool writes
// `{"@patchwork":{"agent":{chatUrl,...}}}` as JSON (see chat's
// agent-change.ts); anything else — no message, free text, foreign JSON —
// is simply not an agent edit. Never throws.
export function parseAgentTag(
  message: string | null | undefined
): AgentTag | undefined {
  if (!message || message[0] !== "{") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return undefined;
  }
  const agent = (
    parsed as { "@patchwork"?: { agent?: Record<string, unknown> } }
  )?.["@patchwork"]?.agent;
  if (!agent || typeof agent.chatUrl !== "string") return undefined;
  // Rebuild the tag field-by-field: only known, well-typed fields survive
  // (the object gets persisted into the group doc, where undefined values
  // and foreign shapes are unwelcome).
  const tag: AgentTag = { chatUrl: agent.chatUrl as AutomergeUrl };
  if (
    Array.isArray(agent.chatHeads) &&
    agent.chatHeads.every((h) => typeof h === "string")
  ) {
    tag.chatHeads = agent.chatHeads as string[];
  }
  if (typeof agent.toolCallId === "string") tag.toolCallId = agent.toolCallId;
  return tag;
}

// Newest first by timestamp, per-doc causal order breaking same-second ties.
// The sidebar's on-demand scrub resolution MUST order identically, or the
// scrubber's index math drifts from `changeCount`.
function newestFirst(a: PendingChange, b: PendingChange): number {
  return b.time - a.time || b.seq - a.seq;
}

// The `@comments` shape the grouper reads: just enough to reach every
// comment's wall-clock timestamp (ms). Structurally matches the comments
// tools' schema without a build-time dependency on them.
type DocWithCommentTimes = {
  "@comments"?: {
    threads?: { comments?: { timestamp?: number }[] }[];
  };
};

// Every comment timestamp (ms) across the given member docs, newest first.
// These are extra group boundaries: a group never spans across the moment a
// comment was made, so the sidebar can slot the comment in between rows.
export function collectCommentTimes(
  docs: Automerge.Doc<unknown>[]
): number[] {
  const times: number[] = [];
  for (const doc of docs) {
    const threads = (doc as DocWithCommentTimes)["@comments"]?.threads;
    if (!threads) continue;
    for (const thread of threads) {
      for (const comment of thread.comments ?? []) {
        if (typeof comment.timestamp === "number") {
          times.push(comment.timestamp);
        }
      }
    }
  }
  return times.sort((a, b) => b - a);
}

// Fold a flat, newest-first list of changes into groups: consecutive changes
// stay together while the pause between them is at most the inactivity gap
// AND no comment was made in between (`commentTimesMs`, newest first) AND
// they belong to the same contributor (`keyOf`, when given — so a row is one
// person's manual edits or one chat's agent edits, never a mix). A comment
// reads as its own timeline entry, so the changes before and after it must
// not aggregate into one row. The comment boundary is half-open — a comment
// at millisecond c splits rows older-or-equal from rows strictly newer — so
// the comment's own write (stamped in the same second as c) groups with the
// OLDER side, where it aggregates to 0/0 and stays hidden. Generic over the
// row shape (only `time`, Unix seconds, is read) so tests can drive it
// directly.
export function splitIntoGroups<T extends { time: number }>(
  rowsNewestFirst: T[],
  commentTimesMs: number[] = [],
  keyOf?: (row: T) => string
): T[][] {
  const groups: T[][] = [];
  let window: T[] = [];
  let prevTimeMs: number | null = null;
  let prevKey: string | undefined;
  let ci = 0;
  for (const row of rowsNewestFirst) {
    const timeMs = row.time * 1000;
    const key = keyOf?.(row);
    // Rows arrive newest-first, so the previous row is this change's newer
    // neighbour; a gap larger than the threshold between them is a lull.
    if (prevTimeMs !== null && window.length > 0) {
      // Comments at or after the newer neighbour can't split this boundary,
      // nor any older one below — skip them once (both lists descend).
      while (
        ci < commentTimesMs.length &&
        commentTimesMs[ci] >= prevTimeMs
      ) {
        ci++;
      }
      const commentBetween =
        ci < commentTimesMs.length && commentTimesMs[ci] >= timeMs;
      if (
        prevTimeMs - timeMs > INACTIVITY_GAP_MS ||
        commentBetween ||
        key !== prevKey
      ) {
        groups.push(window);
        window = [];
      }
    }
    window.push(row);
    prevTimeMs = timeMs;
    prevKey = key;
  }
  if (window.length > 0) groups.push(window);
  return groups;
}

function groupId(rowsNewestFirst: PendingChange[]): string {
  return `tg-${rowsNewestFirst[0].hash}`;
}

// Stable id for a merged draft's dedicated group — keyed by the draft, not
// its newest hash, so rebuilds can cheaply match it against the stored one.
function mergeGroupId(draftUrl: AutomergeUrl): string {
  return `tg-merge-${draftUrl}`;
}

// Append `member`'s changes since `since` onto `out`, dropping anything from
// before the root document was created (a member dragged in after the fact
// would otherwise contribute pre-existing history that reads as noise). `seq`
// still reflects each change's position in the gathered metas, so filtering
// doesn't disturb the tie-break ordering.
function collectMemberRows(
  out: PendingChange[],
  member: DraftMemberDoc,
  doc: Automerge.Doc<unknown>,
  since: Automerge.Heads,
  createdAt: number | undefined
): void {
  let metas;
  try {
    metas = Automerge.getChangesMetaSince(doc, since);
  } catch (err) {
    console.warn(
      "[drafts] change grouping: failed to read changes for member:",
      member.url,
      err
    );
    return;
  }
  metas.forEach((meta, seq) => {
    if (createdAt !== undefined && meta.time && meta.time < createdAt) return;
    const row: PendingChange = {
      memberUrl: member.url,
      doc,
      hash: meta.hash,
      deps: meta.deps,
      time: meta.time,
      actor: meta.actor,
      seq,
    };
    const agent = parseAgentTag(meta.message);
    if (agent) row.agent = agent;
    if (meta.message) {
      // Debug: every change that carries a message, and whether it parsed as
      // an agent tag — the first place to look when attribution seems dead.
      console.log(
        "[drafts] change",
        meta.hash.slice(0, 8),
        "on",
        member.url,
        "message:",
        meta.message,
        "→ agent:",
        agent ? agent.chatUrl : "NO (not a valid agent tag)"
      );
    }
    out.push(row);
  });
}

function dedupedActors(rowsNewestFirst: PendingChange[]): string[] {
  const actors: string[] = [];
  for (const row of rowsNewestFirst) {
    if (!actors.includes(row.actor)) actors.push(row.actor);
  }
  return actors;
}

// The group's agent tag: the newest row's, but only when EVERY row is an
// agent edit from the same chat. Contributor-keyed groups satisfy that by
// construction; merged-draft groups (never split) earn the tag only when the
// whole contribution came from one chat.
function agentForRows(rowsNewestFirst: PendingChange[]): AgentTag | undefined {
  const newest = rowsNewestFirst[0].agent;
  if (!newest) return undefined;
  for (const row of rowsNewestFirst) {
    if (!row.agent || row.agent.chatUrl !== newest.chatUrl) return undefined;
  }
  return newest;
}

// Yield to the main thread between diff slices.
function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

// Time-budgeted cooperative slicing: `tick()` resolves immediately while the
// current slice has budget left, otherwise runs `onYield` (flush pending
// writes) and waits for idle time. Resolves false once the run is aborted.
type Slicer = { tick: () => Promise<boolean> };

function createSlicer(isAborted: () => boolean, onYield: () => void): Slicer {
  let sliceStart = performance.now();
  return {
    async tick(): Promise<boolean> {
      if (isAborted()) return false;
      if (performance.now() - sliceStart < SLICE_BUDGET_MS) return true;
      onYield();
      await idle();
      sliceStart = performance.now();
      return !isAborted();
    },
  };
}

// Diff every change in a group (newest-first, sliced) and aggregate the
// result down to the ChangeGroup a timeline row renders. Returns null when
// the run was aborted mid-diff.
async function buildGroup(
  rowsNewestFirst: PendingChange[],
  slicer: Slicer,
  keyOf: (row: PendingChange) => string
): Promise<ChangeGroup | null> {
  let additions = 0;
  let deletions = 0;
  for (const row of rowsNewestFirst) {
    if (!(await slicer.tick())) return null;
    const counts = computeEditCounts(row.doc, row.hash, row.deps);
    additions += counts.additions;
    deletions += counts.deletions;
  }
  const newest = rowsNewestFirst[0];
  const oldest = rowsNewestFirst[rowsNewestFirst.length - 1];
  const group: ChangeGroup = {
    id: groupId(rowsNewestFirst),
    startTime: oldest.time,
    endTime: newest.time,
    newestMemberUrl: newest.memberUrl,
    newestHash: newest.hash,
    actors: dedupedActors(rowsNewestFirst),
    contributorKey: keyOf(newest),
    additions,
    deletions,
    changeCount: rowsNewestFirst.length,
  };
  const agent = agentForRows(rowsNewestFirst);
  if (agent) group.agent = agent;
  console.log(
    "[drafts] built group",
    group.id,
    "changes:",
    group.changeCount,
    "key:",
    group.contributorKey,
    agent ? `agent: ${agent.chatUrl}` : ""
  );
  return group;
}

function byMemberUrl(a: DraftMemberDoc, b: DraftMemberDoc): number {
  return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
}

export function sameHeads(
  a: UrlHeads | undefined,
  b: UrlHeads | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((h) => set.has(h));
}

// Groups each timeline's changes into its ChangeGroupDoc. It owns one
// background task per timeline, listens to member docs for edits, and updates
// newest groups first while older history backfills. One global runner
// processes timelines sequentially in the priority order it was given.
export function createChangeGrouper(
  repo: Repo,
  options: ChangeGrouperOptions = {}
): ChangeGrouper {
  // Change listeners on the docs a timeline reads (originals for main,
  // clones for drafts). `handle` is null while the doc is still resolving —
  // the slot is reserved up front so concurrent syncs don't double-attach.
  type SourceListener = {
    handle: DocHandle<unknown> | null;
    onChange: (payload: DocHandleChangePayload<unknown>) => void;
  };

  type Task = {
    key: AutomergeUrl; // the DraftDoc url
    spec: TimelineGroupingSpec;
    listeners: Map<AutomergeUrl, SourceListener>;
    queued: boolean;
    debounce: ReturnType<typeof setTimeout> | null;
  };

  const tasks = new Map<AutomergeUrl, Task>();
  const queue: AutomergeUrl[] = [];
  let running = false;
  let disposed = false;

  console.log(
    "[drafts] change grouper created (v" +
      CHANGE_GROUP_DOC_VERSION +
      "), resolveContact wired:",
    !!options.resolveContact
  );

  // The contributor a row belongs to, and so what groups split on: one
  // chat's agent edits, else the actor's contact (many actor ids, one
  // person), else the raw actor id until attribution catches up. An actor
  // attributed only after its rows were grouped keeps its actor-keyed rows
  // until the next full rebuild — accepted, same class of staleness as the
  // sidebar's unattributed-avatar fallback.
  const contributorKey = (row: PendingChange): string =>
    row.agent
      ? `agent:${row.agent.chatUrl}`
      : (options.resolveContact?.(row.actor) ?? `actor:${row.actor}`);

  // Host-doc creation times, resolved once per root url.
  const creationTimes = new Map<AutomergeUrl, Promise<number | undefined>>();
  const creationTime = (url: AutomergeUrl): Promise<number | undefined> => {
    let cached = creationTimes.get(url);
    if (!cached) {
      cached = getDocCreationTime(repo, url);
      creationTimes.set(url, cached);
    }
    return cached;
  };

  function setTimelines(specs: TimelineGroupingSpec[]): void {
    if (disposed) return;
    const keep = new Set(specs.map((s) => s.draftHandle.url));
    for (const [key, task] of [...tasks]) {
      if (!keep.has(key)) removeTask(task);
    }
    for (const spec of specs) {
      const key = spec.draftHandle.url;
      let task = tasks.get(key);
      const membersChanged =
        !task || !sameMemberSets(task.spec.members, spec.members);
      const mergesChanged =
        !task || !sameMergedDrafts(task.spec.mergedDrafts, spec.mergedDrafts);
      if (!task) {
        task = { key, spec, listeners: new Map(), queued: false, debounce: null };
        tasks.set(key, task);
      } else {
        task.spec = spec;
      }
      void ensureListeners(task);
      if (membersChanged || mergesChanged) schedule(key);
    }
  }

  function dispose(): void {
    disposed = true;
    for (const [, task] of [...tasks]) removeTask(task);
    queue.length = 0;
  }

  return { setTimelines, dispose };

  function removeTask(task: Task): void {
    if (task.debounce) clearTimeout(task.debounce);
    task.debounce = null;
    for (const [, { handle, onChange }] of task.listeners) {
      handle?.off("change", onChange);
    }
    task.listeners.clear();
    // A queued entry is skipped by the pump once the task is gone.
    tasks.delete(task.key);
  }

  function sameMemberSets(a: DraftMemberDoc[], b: DraftMemberDoc[]): boolean {
    if (a.length !== b.length) return false;
    const key = (m: DraftMemberDoc) => `${m.url}:${m.cloneUrl ?? ""}`;
    const set = new Set(a.map(key));
    return b.every((m) => set.has(key(m)));
  }

  // Merged drafts compare by url alone: a merge's head ranges are recorded
  // once and never change, so a new url is the only meaningful difference.
  function sameMergedDrafts(
    a: MergedDraftSpec[],
    b: MergedDraftSpec[]
  ): boolean {
    if (a.length !== b.length) return false;
    const set = new Set(a.map((m) => m.url));
    return b.every((m) => set.has(m.url));
  }

  // Keep exactly one change listener per member source doc; edits schedule a
  // debounced grouping update for the owning timeline.
  async function ensureListeners(task: Task): Promise<void> {
    const wanted = new Set(
      task.spec.members.map((m) => m.cloneUrl ?? m.url)
    );
    for (const [url, { handle, onChange }] of [...task.listeners]) {
      if (!wanted.has(url)) {
        handle?.off("change", onChange);
        task.listeners.delete(url);
      }
    }
    for (const url of wanted) {
      if (task.listeners.has(url)) continue;
      const onChange = (payload: DocHandleChangePayload<unknown>) => {
        if (
          options.onLocalChange &&
          LOCAL_PATCH_SOURCES.has(payload.patchInfo.source) &&
          payload.doc
        ) {
          options.onLocalChange(payload.doc);
        }
        if (task.debounce) clearTimeout(task.debounce);
        task.debounce = setTimeout(() => {
          task.debounce = null;
          schedule(task.key);
        }, GROUPING_DEBOUNCE_MS);
      };
      const slot: SourceListener = { handle: null, onChange };
      task.listeners.set(url, slot);
      try {
        const handle = await repo.find<unknown>(url);
        // The task was torn down or the slot dropped while resolving.
        if (disposed || tasks.get(task.key) !== task) return;
        if (task.listeners.get(url) !== slot) return;
        handle.on("change", onChange);
        slot.handle = handle;
      } catch (err) {
        if (task.listeners.get(url) === slot) task.listeners.delete(url);
        console.warn(
          "[drafts] change grouping: failed to watch member:",
          url,
          err
        );
      }
    }
  }

  function schedule(key: AutomergeUrl): void {
    if (disposed) return;
    const task = tasks.get(key);
    if (!task || task.queued) return;
    task.queued = true;
    queue.push(key);
    void pump();
  }

  async function pump(): Promise<void> {
    if (running || disposed) return;
    running = true;
    try {
      while (queue.length > 0 && !disposed) {
        const key = queue.shift()!;
        const task = tasks.get(key);
        if (!task) continue;
        task.queued = false;
        try {
          await updateTimelineGroups(task);
        } catch (err) {
          console.warn(
            "[drafts] change grouping failed for:",
            key,
            err
          );
        }
      }
    } finally {
      running = false;
    }
  }

  // Update one timeline. The common case appends the unconsumed
  // tail onto the newest group; anything that would reshape older groups
  // (late-syncing changes, a fresh document) falls back to a full rebuild
  // that reuses stored groups wherever they come out identical.
  async function updateTimelineGroups(task: Task): Promise<void> {
    const spec = task.spec;
    // The run is stale once the task was replaced or torn down (a newer spec
    // re-queues itself), or the ChangeGrouper was disposed.
    const isAborted = () => disposed || tasks.get(task.key) !== task;

    if (!spec.draftHandle.doc()) return;
    const changeGroupHandle = await ensureChangeGroupDoc(
      repo,
      spec.draftHandle
    );
    const createdAt = await creationTime(spec.rootDocUrl);
    if (isAborted()) return;

    // Resolve member sources, sorted by member url so cross-doc timestamp
    // ties interleave identically on every client.
    const members = [...spec.members].sort(byMemberUrl);
    const sources: { member: DraftMemberDoc; doc: Automerge.Doc<unknown> }[] =
      [];
    for (const member of members) {
      try {
        const handle = await repo.find<unknown>(member.cloneUrl ?? member.url);
        const doc = handle.doc();
        if (doc) sources.push({ member, doc: doc as Automerge.Doc<unknown> });
      } catch (err) {
        console.warn(
          "[drafts] change grouping: failed to resolve member:",
          member,
          err
        );
      }
    }
    if (isAborted()) return;

    const changeGroupDoc = changeGroupHandle.doc();
    if (!changeGroupDoc) return;
    const computedThrough = changeGroupDoc.computedThrough ?? {};

    // A merged draft the stored grouping hasn't attributed yet always forces
    // a full rebuild: its changes must come OUT of whatever time-based groups
    // they already sit in — they may even be fully consumed already, if a
    // grouping run raced ahead of the provider's spec update.
    const attributedMerges = changeGroupDoc.attributedMerges ?? {};
    const hasNewMerge = spec.mergedDrafts.some(
      (md) => !attributedMerges[md.url]
    );

    // Each member's frontier as of this gather; the consumed marker advances
    // to exactly these once the run completes, so the next run's
    // getChangesMetaSince yields precisely the unconsumed tail.
    const frontier: Record<AutomergeUrl, UrlHeads> = {};
    const tails: PendingChange[] = [];
    for (const { member, doc } of sources) {
      frontier[member.url] = encodeHeads(Automerge.getHeads(doc));
      const consumed = computedThrough[member.url];
      const since = consumed
        ? decodeHeads(consumed)
        : member.clonedAt
          ? decodeHeads(member.clonedAt)
          : [];
      collectMemberRows(tails, member, doc, since, createdAt);
    }

    if (tails.length > 0) {
      // Debug: one line per grouping run — proves the grouper saw the new
      // changes and how many carried an agent tag.
      console.log(
        "[drafts] grouping run for",
        spec.draftHandle.url,
        "— tail rows:",
        tails.length,
        "agent-tagged:",
        tails.filter((r) => r.agent).length
      );
    }

    if (tails.length === 0 && !hasNewMerge) {
      // Nothing new to group; just record any frontier movement (e.g. members
      // whose unconsumed changes were all filtered out, or brand-new members
      // with no post-fork changes yet).
      const stale = Object.entries(frontier).filter(
        ([url, heads]) => !sameHeads(computedThrough[url as AutomergeUrl], heads)
      );
      if (stale.length > 0) {
        changeGroupHandle.change((d) => {
          for (const [url, heads] of stale) {
            d.computedThrough[url as AutomergeUrl] = heads;
          }
        });
      }
      return;
    }

    tails.sort(newestFirst);

    // Comment timestamps across the member docs: extra group boundaries for
    // both grouping paths below. Comments live in the same docs the changes
    // come from (clones for drafts), so a new comment also fires the change
    // listener that scheduled this run.
    const commentTimesMs = collectCommentTimes(sources.map((s) => s.doc));

    // Fast path: no merge to attribute, and every new change lands on or
    // after the newest stored group (extending it or opening newer ones)
    // without bridging into the group below it — the overwhelmingly common
    // live-editing case. Everything else (first build, members without a
    // consumed marker, late-syncing changes with old timestamps, a freshly
    // merged draft) rebuilds via the full pass.
    const stored = Object.values(changeGroupDoc.groups ?? {}).sort(
      (a, b) => b.endTime - a.endTime
    );
    const newestStored = stored[0];
    const secondStored = stored[1];
    const tailOldestMs =
      tails.length > 0 ? tails[tails.length - 1].time * 1000 : 0;
    const fastOk =
      !hasNewMerge &&
      tails.length > 0 &&
      !!newestStored &&
      tailOldestMs >= newestStored.startTime * 1000 - INACTIVITY_GAP_MS &&
      (!secondStored ||
        tailOldestMs - secondStored.endTime * 1000 > INACTIVITY_GAP_MS);

    if (fastOk) {
      await appendTail(
        changeGroupHandle,
        newestStored,
        tails,
        commentTimesMs,
        frontier,
        isAborted
      );
    } else {
      await rebuildAll(
        changeGroupHandle,
        sources,
        createdAt,
        commentTimesMs,
        frontier,
        spec.mergedDrafts,
        isAborted
      );
    }
  }

  // Incremental append: diff only the tail, then extend the newest stored
  // group (accumulate counts, union actors, bump the anchor) and/or open new
  // groups above it. No stored aggregate is ever decomposed.
  async function appendTail(
    changeGroupHandle: DocHandle<ChangeGroupDoc>,
    newestStored: ChangeGroup,
    tailsNewestFirst: PendingChange[],
    commentTimesMs: number[],
    frontier: Record<AutomergeUrl, UrlHeads>,
    isAborted: () => boolean
  ): Promise<void> {
    const tailGroups = splitIntoGroups(
      tailsNewestFirst,
      commentTimesMs,
      contributorKey
    );
    const oldestGroup = tailGroups[tailGroups.length - 1];
    const oldestGroupOldestMs =
      oldestGroup[oldestGroup.length - 1].time * 1000;
    // A comment made between the stored group's end and the tail's start is
    // a boundary too (same half-open convention as splitIntoGroups), so the
    // tail must open a fresh group above it.
    const commentBetween = commentTimesMs.some(
      (c) => c >= newestStored.endTime * 1000 && c < oldestGroupOldestMs
    );
    // The oldest run of new changes merges into the stored group when no lull
    // (and no comment) separates them (it may even start inside the stored
    // span) AND it belongs to the same contributor — unless the stored group
    // is a merged draft's: that group holds exactly the draft's contribution,
    // so edits after the merge always open a fresh group.
    const attaches =
      !newestStored.merge &&
      !commentBetween &&
      contributorKey(oldestGroup[0]) === newestStored.contributorKey &&
      oldestGroupOldestMs <= newestStored.endTime * 1000 + INACTIVITY_GAP_MS;
    const freshGroups = attaches ? tailGroups.slice(0, -1) : tailGroups;

    const slicer = createSlicer(isAborted, () => {});
    const built: ChangeGroup[] = [];
    for (const rows of freshGroups) {
      const group = await buildGroup(rows, slicer, contributorKey);
      if (group === null) return;
      built.push(group);
    }

    let extensionSums: { additions: number; deletions: number } | null = null;
    if (attaches) {
      let additions = 0;
      let deletions = 0;
      for (const row of oldestGroup) {
        if (!(await slicer.tick())) return;
        const counts = computeEditCounts(row.doc, row.hash, row.deps);
        additions += counts.additions;
        deletions += counts.deletions;
      }
      extensionSums = { additions, deletions };
    }

    if (isAborted()) return;
    changeGroupHandle.change((d) => {
      for (const group of built) d.groups[group.id] = group;
      if (attaches && extensionSums) {
        extendGroup(d, newestStored, oldestGroup, extensionSums);
      }
      for (const [url, heads] of Object.entries(frontier)) {
        d.computedThrough[url as AutomergeUrl] = heads;
      }
    });
  }

  // Fold a tail run into the newest stored group inside an open change():
  // re-read the group from the live doc so a concurrently synced extension is
  // extended further rather than clobbered.
  function extendGroup(
    d: ChangeGroupDoc,
    storedSnapshot: ChangeGroup,
    tailNewestFirst: PendingChange[],
    sums: { additions: number; deletions: number }
  ): void {
    const tailNewest = tailNewestFirst[0];
    const tailOldest = tailNewestFirst[tailNewestFirst.length - 1];
    const tailAgent = agentForRows(tailNewestFirst);
    const base = d.groups[storedSnapshot.id];
    if (!base) {
      // The stored group vanished under us (concurrent rewrite); keep the
      // tail as its own group rather than losing it — the next full pass
      // reconciles the shape.
      const fallback: ChangeGroup = {
        id: `tg-${tailNewest.hash}`,
        startTime: tailOldest.time,
        endTime: tailNewest.time,
        newestMemberUrl: tailNewest.memberUrl,
        newestHash: tailNewest.hash,
        actors: dedupedActors(tailNewestFirst),
        contributorKey: contributorKey(tailNewest),
        additions: sums.additions,
        deletions: sums.deletions,
        changeCount: tailNewestFirst.length,
      };
      if (tailAgent) fallback.agent = tailAgent;
      d.groups[fallback.id] = fallback;
      return;
    }

    // The tail is newer causally, but a merge can deliver changes stamped
    // inside the stored span; only a strictly later timestamp moves the
    // anchor.
    const newer = tailNewest.time > base.endTime;
    const tailActors = dedupedActors(tailNewestFirst);
    const baseActors = [...base.actors];
    const actors = newer
      ? [...tailActors, ...baseActors.filter((a) => !tailActors.includes(a))]
      : [...baseActors, ...tailActors.filter((a) => !baseActors.includes(a))];

    const extended: ChangeGroup = {
      id: newer ? `tg-${tailNewest.hash}` : base.id,
      startTime: Math.min(base.startTime, tailOldest.time),
      endTime: Math.max(base.endTime, tailNewest.time),
      newestMemberUrl: newer ? tailNewest.memberUrl : base.newestMemberUrl,
      newestHash: newer ? tailNewest.hash : base.newestHash,
      actors,
      // Same contributor by the attach condition, so the key carries over.
      contributorKey: base.contributorKey,
      additions: base.additions + sums.additions,
      deletions: base.deletions + sums.deletions,
      changeCount: base.changeCount + tailNewestFirst.length,
    };
    // Same-chat by the attach condition too; a newer tail's tag wins so
    // `chatHeads` tracks the latest run that touched the group. Deep-copied
    // because `base.agent` is a live proxy of the doc being mutated.
    const agent = newer ? (tailAgent ?? base.agent) : (base.agent ?? tailAgent);
    if (agent) {
      const copy: AgentTag = { chatUrl: agent.chatUrl };
      if (agent.chatHeads) copy.chatHeads = [...agent.chatHeads];
      if (agent.toolCallId) copy.toolCallId = agent.toolCallId;
      extended.agent = copy;
    }
    if (extended.id !== storedSnapshot.id) delete d.groups[storedSnapshot.id];
    d.groups[extended.id] = extended;
  }

  // Full rebuild: regather every member's post-fork history, pull each
  // merged draft's contribution out into its own dedicated group, re-split
  // the rest by time, and diff newest-first in idle slices — flushing
  // completed groups as each slice ends so recent history paints while older
  // history backfills. A stored group whose id, span, and change count match
  // is reused without re-diffing (cheap warm restarts, and no redundant work
  // when another client's grouping update syncs in). Stale ids, consumed
  // markers, and attributed-merge markers settle in the final write.
  async function rebuildAll(
    changeGroupHandle: DocHandle<ChangeGroupDoc>,
    sources: { member: DraftMemberDoc; doc: Automerge.Doc<unknown> }[],
    createdAt: number | undefined,
    commentTimesMs: number[],
    frontier: Record<AutomergeUrl, UrlHeads>,
    mergedDrafts: MergedDraftSpec[],
    isAborted: () => boolean
  ): Promise<void> {
    const rows: PendingChange[] = [];
    for (const { member, doc } of sources) {
      const since = member.clonedAt ? decodeHeads(member.clonedAt) : [];
      collectMemberRows(rows, member, doc, since, createdAt);
    }
    rows.sort(newestFirst);
    const { merged, rest } = partitionRows(rows, mergedDrafts);
    const groupsRows = splitIntoGroups(rest, commentTimesMs, contributorKey);
    const expectedIds = new Set(groupsRows.map(groupId));

    const batch: ChangeGroup[] = [];
    const flush = () => {
      if (batch.length === 0) return;
      changeGroupHandle.change((d) => {
        for (const group of batch) d.groups[group.id] = group;
      });
      batch.length = 0;
    };

    const slicer = createSlicer(isAborted, flush);

    // One dedicated group per merged draft, regardless of how its changes
    // interleave in time with the rest. A merge with no contributed rows
    // produces no group; it still settles through the attributedMerges
    // marker in the final write.
    for (const draft of mergedDrafts) {
      const draftRows = merged.get(draft.url) ?? [];
      if (draftRows.length === 0) continue;
      const id = mergeGroupId(draft.url);
      expectedIds.add(id);
      const existing = changeGroupHandle.doc()?.groups?.[id];
      if (
        existing &&
        existing.changeCount === draftRows.length &&
        existing.startTime === draftRows[draftRows.length - 1].time &&
        existing.endTime === draftRows[0].time
      ) {
        continue;
      }
      const group = await buildGroup(draftRows, slicer, contributorKey);
      if (group === null) return; // aborted mid-diff; markers stay put
      batch.push({
        ...group,
        id,
        merge: {
          draftUrl: draft.url,
          name: draft.name,
          members: draft.members,
        },
      });
    }

    for (const groupRows of groupsRows) {
      const id = groupId(groupRows);
      const existing = changeGroupHandle.doc()?.groups?.[id];
      if (
        existing &&
        existing.changeCount === groupRows.length &&
        existing.startTime === groupRows[groupRows.length - 1].time &&
        existing.endTime === groupRows[0].time
      ) {
        continue;
      }
      const group = await buildGroup(groupRows, slicer, contributorKey);
      if (group === null) return; // aborted mid-diff; markers stay put
      batch.push(group);
    }

    if (isAborted()) return;
    changeGroupHandle.change((d) => {
      for (const group of batch) d.groups[group.id] = group;
      for (const id of Object.keys(d.groups)) {
        if (!expectedIds.has(id)) delete d.groups[id];
      }
      for (const [url, heads] of Object.entries(frontier)) {
        d.computedThrough[url as AutomergeUrl] = heads;
      }
      if (mergedDrafts.length > 0) {
        if (!d.attributedMerges) d.attributedMerges = {};
        for (const md of mergedDrafts) {
          if (!d.attributedMerges[md.url]) d.attributedMerges[md.url] = true;
        }
      }
    });
  }
}
