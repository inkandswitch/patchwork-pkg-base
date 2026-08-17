import "./styles.css";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type Accessor,
} from "solid-js";
import { createDocSignal } from "solid-automerge";
import type {
  AutomergeUrl,
  DocHandle,
  Repo,
  UrlHeads,
} from "@automerge/automerge-repo/slim";
import {
  decodeHeads,
  encodeHeads,
  isValidAutomergeUrl,
} from "@automerge/automerge-repo/slim";
import * as Automerge from "@automerge/automerge/slim";
import {
  subscribe,
  subscribeDoc,
} from "@inkandswitch/patchwork-providers-solid";
import type {
  ActorAttributionDoc,
  ChangeGroup,
  ChangeGroupDoc,
  CheckedOutDraft,
  CloneEntry,
  DraftCheckpoint,
  DraftDoc,
  DraftList,
  DraftMemberDoc,
  DraftSummary,
  HasDrafts,
} from "./draft-types";
import {
  computeEditCounts,
  computeRangeEditCounts,
  getDocCreationTime,
  sameHeads,
} from "./change-group-cache";
import { ensureMainDraft } from "./draft-docs";

// Seed for the read-only `draft:list` subscription until the provider answers.
// `main.url` is a placeholder; the Main card displays the host doc url instead.
const EMPTY_DRAFT_LIST: DraftList = {
  main: {
    url: "" as AutomergeUrl,
    parent: null,
    members: [],
    childCount: 0,
    name: null,
    changeGroupDocUrl: null,
  },
  drafts: [],
  actorAttributionUrl: null,
};

// Shown in the panel footer, logged on load, and stamped into fork
// diagnostics; bump on deploy to tell builds apart.
const DRAFTS_VERSION = "0.0.46";

// Logged at module load so the console shows which build is running even
// before the panel renders.
console.log(`[drafts] DraftsSidebar v${DRAFTS_VERSION} loaded`);

export function DraftsSidebar(props: { element: HTMLElement }) {
  const [hostDoc, hostDocHandle] = subscribeDoc<HasDrafts>(props.element, {
    type: "draft:root-doc",
  });

  // Selection only: which draft is checked out (writeable).
  const [, checkedOutHandle] = subscribeDoc<CheckedOutDraft>(props.element, {
    type: "draft:checked-out",
  });

  // Read the checkout doc coarsely from the live handle (handle.doc()) rather
  // than a fine-grained patch-replay projection: the projection can render a
  // whole-value write doubled, whereas handle.doc() is always the correct
  // materialized document.
  const checkedOut = createDocSignal(checkedOutHandle);
  const selected = createMemo<AutomergeUrl | null>(
    () => checkedOut()?.checkedOut ?? null
  );

  // The eye toggle's state, derived from the checkpoint itself (no separate
  // flag): the eye is open — diffs showing — iff the current checkpoint
  // carries any diff baseline (`from`).
  const eyeOpen = createMemo<boolean>(() => {
    const at = checkedOut()?.at;
    return !!at && Object.values(at).some((e) => e.from !== undefined);
  });

  // Whether the view is actually pinned to history (any member has a `to`),
  // as opposed to live-with-baseline (eye open, nothing pinned).
  const isPinned = createMemo<boolean>(() => {
    const at = checkedOut()?.at;
    return !!at && Object.values(at).some((e) => e.to !== undefined);
  });

  // Where the scrubber sits: the change whose heads are displayed. Ephemeral,
  // client-only state: the stored checkpoint (`checkedOut.at`) is what
  // actually pins the view; this mirrors it to render the token and the
  // group highlight. Not persisted, so it resets on reload (the pinned view
  // survives).
  const [scrubber, setScrubber] = createSignal<ScrubberState | null>(null);

  // Where the diff baseline handle sits: an absolute point in history the
  // diff is measured from, independent of the head (`scrubber`). Ephemeral
  // like the head — resets on reload, while the persisted `from` keeps
  // driving the editor diff. Non-null only while the eye is open and a
  // version is pinned; that is also exactly when the handle renders.
  const [baseliner, setBaseliner] = createSignal<BaselineState | null>(null);

  // The derived drafts list (read-only): main plus each draft with its member
  // docs, recomputed and pushed by the provider.
  const list = subscribe<DraftList>(
    props.element,
    { type: "draft:list" },
    EMPTY_DRAFT_LIST
  );

  // Feed the module-level attribution store from this host doc's attribution
  // doc, so `AuthorAvatars` can render contacts instead of raw actor ids.
  createEffect(() => {
    const url = list().actorAttributionUrl;
    const repo = getRepo();
    if (!url || !repo) return;
    let disposed = false;
    let off: (() => void) | null = null;
    void repo.find<ActorAttributionDoc>(url).then(
      (handle) => {
        if (disposed) return;
        const update = () => {
          const actors = handle.doc()?.actors;
          if (actors && Object.keys(actors).length > 0) {
            setActorContacts((prev) => ({ ...prev, ...actors }));
          }
        };
        handle.on("change", update);
        off = () => handle.off("change", update);
        update();
      },
      (err) => {
        console.warn("[drafts] failed to load actor attribution:", url, err);
      }
    );
    onCleanup(() => {
      disposed = true;
      off?.();
    });
  });

  const isMainSelected = createMemo(() => selected() === null);
  // Drafting off a folder isn't supported yet, so creating a draft is disabled
  // while viewing a folder on Main.
  const isFolder = createMemo(
    () => hostDoc()?.["@patchwork"]?.type === "folder"
  );

  const selectDraft = (url: AutomergeUrl | null) => {
    const handle = checkedOutHandle();
    if (!handle) return;
    setScrubber(null);
    setBaseliner(null);
    handle.change((d) => {
      d.checkedOut = url;
      // Switching drafts (or to main) returns to the live latest heads.
      d.at = null;
    });
  };

  const getRepo = (): Repo | undefined =>
    "repo" in window ? window.repo : undefined;

  // Monotonic counter so a slow checkpoint computation can't overwrite a newer
  // scrub position (a drag fires one recompute per snapped change).
  let scrubSeq = 0;

  // Recompute and persist the checkpoint from the current head (`scrubber`)
  // and baseline (`baseliner`) signals: `to`s follow the head, `from`s follow
  // the baseline (absolute, independent of the head). With the eye closed the
  // baseline is null and no `from` is written. The token and row highlight
  // update immediately from the signals; the checkpoint follows async.
  // `draftUrl` is `null` for main. Guarded by `scrubSeq` so a slower
  // computation can't clobber a newer drag.
  const applyPins = (
    draftUrl: AutomergeUrl | null,
    members: DraftMemberDoc[]
  ) => {
    const handle = checkedOutHandle();
    const repo = getRepo();
    if (!handle || !repo) return;
    const head = scrubber();
    if (!head) return;
    const bl = baseliner();
    const base: CheckpointBase = bl ? { beforeTime: bl.time } : "none";
    const seq = ++scrubSeq;
    void (async () => {
      const checkpoint = await computeCheckpoint(repo, members, head.head, base);
      // A newer scrub landed while this one was computing; drop it.
      if (seq !== scrubSeq) return;
      handle.change((d) => {
        d.checkedOut = draftUrl;
        d.at = checkpoint;
      });
    })();
  };

  // Move the head (the version being viewed); the baseline stays where it is.
  const onScrub = (
    draftUrl: AutomergeUrl | null,
    members: DraftMemberDoc[],
    scrub: ScrubberState
  ) => {
    setScrubber(scrub);
    applyPins(draftUrl, members);
  };

  // Move the diff baseline; the head stays where it is. Only reachable while
  // the eye is open and pinned (that is when the handle renders).
  const onBaselineScrub = (
    draftUrl: AutomergeUrl | null,
    members: DraftMemberDoc[],
    base: BaselineState
  ) => {
    setBaseliner(base);
    applyPins(draftUrl, members);
  };

  // The member docs of the current selection (`null` = main), for the eye
  // and checkpoint handlers below.
  const membersFor = (draftUrl: AutomergeUrl | null): DraftMemberDoc[] =>
    draftUrl
      ? (list().drafts.find((s) => s.url === draftUrl)?.members ?? [])
      : list().main.members;

  // The eye-open checkpoint for a live (unpinned) draft: every cloned member
  // diffs against its fork point, nothing pinned.
  const forkBaselines = (draftUrl: AutomergeUrl): DraftCheckpoint => {
    const at: DraftCheckpoint = {};
    for (const member of membersFor(draftUrl)) {
      if (member.clonedAt) at[member.url] = { from: member.clonedAt };
    }
    return at;
  };

  // Drop the time pin but stay on the same draft: back to live latest heads.
  // With the eye open on a draft the diff baselines survive — the view goes
  // live but keeps showing what changed since the fork point. (A live main
  // has nothing to diff against, so there the eye closes with the pin.)
  const clearCheckpoint = () => {
    const handle = checkedOutHandle();
    if (!handle) return;
    setScrubber(null);
    // Unpinned: the baseline handle only shows while pinned, so drop it.
    setBaseliner(null);
    const draftUrl = selected();
    const baselines = eyeOpen() && draftUrl ? forkBaselines(draftUrl) : null;
    handle.change((d) => {
      d.at =
        baselines && Object.keys(baselines).length > 0 ? baselines : null;
    });
  };

  // The eye toggle: show or hide diff highlighting. The eye holds no state of
  // its own — it rewrites the checkpoint's per-member `from`s (which the
  // provider serves as `draft:baseline`), and its open/closed state is read
  // back off the checkpoint (`eyeOpen`).
  const toggleEye = () => {
    const handle = checkedOutHandle();
    const repo = getRepo();
    if (!handle || !repo) return;

    if (eyeOpen()) {
      // Close: strip the baselines; a pin (`to`) stays untouched. Baseline-
      // only entries disappear entirely, so a live view's `at` goes to null.
      setBaseliner(null);
      handle.change((d) => {
        if (!d.at) return;
        const urls = Object.keys(d.at) as AutomergeUrl[];
        if (!urls.some((u) => d.at?.[u]?.to !== undefined)) {
          d.at = null;
          return;
        }
        for (const url of urls) {
          const entry = d.at[url];
          if (!entry) continue;
          if (entry.to === undefined) delete d.at[url];
          else delete entry.from;
        }
      });
      return;
    }

    const draftUrl = selected();
    const s = scrubber();
    if (isPinned() && s) {
      // Pinned with a known scrub position: seed the baseline handle at the
      // scrubbed group's start and recompute the checkpoint against it. The
      // handle's exact offset is resolved by the changes list, which knows
      // the group's size (BASELINE_GROUP_START).
      setBaseliner({
        groupId: s.groupId,
        offset: BASELINE_GROUP_START,
        time: s.groupStartTime,
      });
      const members = membersFor(draftUrl);
      const seq = ++scrubSeq;
      void (async () => {
        const checkpoint = await computeCheckpoint(repo, members, s.head, {
          beforeTime: s.groupStartTime,
        });
        if (seq !== scrubSeq) return;
        handle.change((d) => {
          d.at = checkpoint;
        });
      })();
      return;
    }

    if (isPinned()) {
      // Pinned but the scrub position is unknown (the sidebar remounted
      // while the pin survived): fall back to diffing the pinned view
      // against the fork point.
      const clonedAt = new Map(
        membersFor(draftUrl).map((m) => [m.url, m.clonedAt])
      );
      handle.change((d) => {
        if (!d.at) return;
        for (const url of Object.keys(d.at) as AutomergeUrl[]) {
          const entry = d.at[url];
          if (!entry) continue;
          entry.from = clonedAt.get(url) ?? encodeHeads([]);
        }
      });
      return;
    }

    // Live on a draft: show what changed since the fork point. (Live on
    // main the button is disabled — there is no baseline to diff against.)
    if (!draftUrl) return;
    const baselines = forkBaselines(draftUrl);
    if (Object.keys(baselines).length === 0) return;
    handle.change((d) => {
      d.at = baselines;
    });
  };

  // While the eye is open on a live (unpinned) draft, keep the baseline map
  // in step with the member list: a doc forked after the eye was opened gets
  // its fork-point baseline added here. (The provider serves baselines only
  // from the checkpoint — there is no implicit fallback to cover it.)
  createEffect(() => {
    const at = checkedOut()?.at;
    const draftUrl = selected();
    const handle = checkedOutHandle();
    if (!at || !draftUrl || !handle) return;
    const entries = Object.values(at);
    if (entries.length === 0) return;
    if (entries.some((e) => e.to !== undefined)) return; // pinned: onScrub owns it
    if (!entries.some((e) => e.from !== undefined)) return; // eye closed
    const missing = membersFor(draftUrl).filter(
      (m) => m.clonedAt !== null && !at[m.url]
    );
    if (missing.length === 0) return;
    handle.change((d) => {
      if (!d.at) return;
      for (const m of missing) {
        if (m.clonedAt) d.at[m.url] = { from: m.clonedAt };
      }
    });
  });

  // Fork the current selection as a new child draft. `atVersion` picks the
  // fork point (the two menu items): true clones every member doc at the
  // heads it had as of the scrubbed version, false forks at the latest
  // heads. The new draft is parented to the selection — merging it later
  // lands back here, not on main. Pre-populating `DraftDoc.clones` means the
  // overlay's lazy `resolveClone` reuses these entries instead of forking
  // the originals at current heads (which matters when forking off a draft:
  // the clones must branch off the draft's clones). Forking main live needs
  // no eager clones — main's members are the originals, so the lazy path is
  // exactly right. Members with no changes at or before a pinned version
  // (created later) are left out; the version's docs don't reference them
  // yet, so they are normally never resolved beneath the draft.
  const onForkSelection = async (atVersion: boolean) => {
    if (isFolder()) return;
    const docHandle = hostDocHandle();
    if (!docHandle) return;
    const repo = getRepo();
    if (!repo) {
      console.warn("[drafts] window.repo is not set");
      return;
    }

    const parentUrl = selected(); // null = main
    const members = membersFor(parentUrl);
    const head = atVersion ? (scrubber()?.head ?? null) : null;

    const clones: Record<AutomergeUrl, CloneEntry> = {};
    if (head) {
      // Reuse the scrub machinery to resolve per-doc heads at this version
      // (only the `to`s are read, so no diff baseline).
      const checkpoint = await computeCheckpoint(repo, members, head, "none");
      for (const member of members) {
        const to = checkpoint[member.url]?.to;
        if (!to) continue;
        let handle: DocHandle<unknown> | null = null;
        try {
          // Clone the doc the timeline read its changes from (the draft's
          // clone when forking off a draft), pinned to the version's heads.
          // Keyed by the original url so baselines and merge-back resolve.
          handle = await repo.find<unknown>(member.cloneUrl ?? member.url);
          const clone = cloneAtVersion(repo, handle, to);
          clones[member.url] = { cloneUrl: clone.url, clonedAt: to };
        } catch (err) {
          reportForkFailure(
            handle ? collectForkDiagnostic(handle, member, to) : null,
            err
          );
        }
      }
    } else if (parentUrl) {
      // Forking a draft at its latest heads: branch each member off the
      // draft's clone (not the original, which lacks the draft's changes).
      for (const member of members) {
        try {
          const source = await repo.find<unknown>(
            member.cloneUrl ?? member.url
          );
          const clonedAt = source.heads();
          const clone = repo.clone(source);
          clones[member.url] = { cloneUrl: clone.url, clonedAt };
        } catch (err) {
          console.warn("[drafts] failed to fork member:", member, err);
        }
      }
    }

    const mainDraft = await ensureMainDraft(repo, docHandle);
    const parentHandle = parentUrl
      ? await repo.find<DraftDoc>(parentUrl)
      : mainDraft;
    // Default name from a monotonic counter on the main draft, stamped at
    // creation so numbering stays stable as drafts are merged or deleted.
    let draftNumber = 1;
    mainDraft.change((d) => {
      d.draftCounter = (d.draftCounter ?? 0) + 1;
      draftNumber = d.draftCounter;
    });
    const draft = repo.create<DraftDoc>({
      "@patchwork": { type: "draft" },
      name: `Draft ${draftNumber}`,
      parent: parentHandle.url,
      drafts: [],
      clones,
    });
    parentHandle.change((d) => {
      d.drafts.push(draft.url);
    });
    selectDraft(draft.url);
  };

  // Rename a draft, or main (`url === null`). Names live on the `DraftDoc`;
  // renaming main creates the main draft doc if this is the first draft-ish
  // action on the host doc. `null` clears back to the default label.
  const onRename = async (url: AutomergeUrl | null, name: string | null) => {
    const repo = getRepo();
    if (!repo) return;
    let handle: DocHandle<DraftDoc>;
    if (url === null) {
      const docHandle = hostDocHandle();
      if (!docHandle) return;
      handle = await ensureMainDraft(repo, docHandle);
    } else {
      handle = await repo.find<DraftDoc>(url);
    }
    handle.change((d) => {
      if (name) d.name = name;
      else delete d.name;
    });
  };

  // The selected draft's summary and parent, driving the merge button on the
  // selected draft's header (it merges up into the parent).
  const selectedSummary = createMemo<DraftSummary | null>(
    () => list().drafts.find((s) => s.url === selected()) ?? null
  );
  const mergeParentUrl = createMemo<AutomergeUrl | null>(
    () => selectedSummary()?.parent ?? null
  );
  // Display name of the merge target (the parent): the tooltip and the
  // confirm dialog both name it.
  const mergeTargetName = createMemo<string>(() => {
    const parentUrl = mergeParentUrl();
    if (parentUrl === null || parentUrl === list().main.url) {
      return list().main.name ?? "Main";
    }
    return list().drafts.find((s) => s.url === parentUrl)?.name ?? "Draft";
  });

  // Label of the menu's fork-from-version item, e.g. "Fork from Jul 24,
  // 3:12 PM" — the change the scrubber sits on. Null (item hidden) while
  // the timeline isn't pinned.
  const forkAtLabel = createMemo<string | null>(() => {
    if (!isPinned()) return null;
    const time = scrubber()?.head.time;
    if (!time) return null;
    return `Fork from ${formatVersionTime(time)}`;
  });

  // True while the menu's merge item is hovered: the target card (the
  // selected draft's parent) lights up via `data-merge-target`.
  const [mergeHighlight, setMergeHighlight] = createSignal(false);

  // Nesting depth for a card's indentation: hops up the parent chain until
  // main (a top-level draft's parent is the main draft, which isn't in the
  // drafts list, so it counts 0). Cycle-guarded — parents are plain urls.
  const draftDepth = (summary: DraftSummary): number => {
    const byUrl = new Map(list().drafts.map((s) => [s.url, s]));
    const seen = new Set<AutomergeUrl>();
    let depth = 0;
    let parent = summary.parent;
    while (parent && byUrl.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      depth++;
      parent = byUrl.get(parent)!.parent;
    }
    return depth;
  };

  // Merge the selected draft into its parent — the draft it was forked off,
  // or main for a top-level draft — then check the parent out. The merged
  // draft's `mergedAt` stamp hides it from the list.
  const onMergeDraft = async () => {
    const draftUrl = selected();
    if (!draftUrl) return;
    const parentUrl = mergeParentUrl();
    if (!window.confirm(`Merge this draft into "${mergeTargetName()}"?`))
      return;
    const repo = getRepo();
    if (!repo) {
      console.warn("[drafts] window.repo is not set");
      return;
    }
    const draftHandle = await repo.find<DraftDoc>(draftUrl);
    await mergeDraft(repo, draftHandle);
    selectDraft(parentUrl && parentUrl !== list().main.url ? parentUrl : null);
  };

  // Delete the selected draft: unlink it from its parent's `drafts` list,
  // which drops it — along with any drafts forked from it — from every
  // peer's tree walk. Nothing is merged and the docs themselves are left in
  // place; the draft just becomes unreachable.
  const onDeleteDraft = async () => {
    const draftUrl = selected();
    if (!draftUrl) return;
    const childCount = selectedSummary()?.childCount ?? 0;
    const warning =
      childCount > 0
        ? "Delete this draft? Drafts forked from it will be deleted too. This can't be undone."
        : "Delete this draft? This can't be undone.";
    if (!window.confirm(warning)) return;
    const repo = getRepo();
    if (!repo) {
      console.warn("[drafts] window.repo is not set");
      return;
    }
    const parentUrl = mergeParentUrl();
    let parentHandle: DocHandle<DraftDoc>;
    if (parentUrl) {
      parentHandle = await repo.find<DraftDoc>(parentUrl);
    } else {
      // Legacy drafts without a `parent` field hang off the main draft.
      const docHandle = hostDocHandle();
      if (!docHandle) return;
      parentHandle = await ensureMainDraft(repo, docHandle);
    }
    parentHandle.change((d) => {
      const i = d.drafts.indexOf(draftUrl);
      if (i >= 0) d.drafts.splice(i, 1);
    });
    selectDraft(parentUrl && parentUrl !== list().main.url ? parentUrl : null);
  };

  return (
    <div class="drafts-panel">
      <Show
        when={hostDoc()}
        fallback={<div class="drafts-empty">No document selected.</div>}
      >
        <div class="drafts-list">
          <MainCard
            hostDocUrl={hostDocHandle()?.url}
            isSelected={isMainSelected()}
            members={() => list().main.members}
            changeGroupDocUrl={list().main.changeGroupDocUrl}
            name={list().main.name}
            onRename={(name) => void onRename(null, name)}
            onSelect={() => selectDraft(null)}
            onScrub={(scrub) => onScrub(null, list().main.members, scrub)}
            scrubber={() => (isMainSelected() ? scrubber() : null)}
            onBaselineScrub={(base) =>
              onBaselineScrub(null, list().main.members, base)
            }
            baseliner={() => (isMainSelected() ? baseliner() : null)}
            checkpoint={() => (isMainSelected() ? (checkedOut()?.at ?? null) : null)}
            hasCheckpoint={isMainSelected() && isPinned()}
            onReturnToLatest={clearCheckpoint}
            eyeOpen={isMainSelected() && eyeOpen()}
            eyeDisabled={!isPinned()}
            onToggleEye={toggleEye}
            forkDisabled={isFolder()}
            onFork={() => void onForkSelection(false)}
            forkAtLabel={forkAtLabel()}
            onForkAt={() => void onForkSelection(true)}
            isMergeTarget={
              mergeHighlight() && mergeParentUrl() === list().main.url
            }
          />
          <For each={list().drafts}>
            {(summary) => (
              <DraftCard
                url={summary.url}
                members={summary.members}
                changeGroupDocUrl={summary.changeGroupDocUrl}
                mainDocUrl={hostDocHandle()?.url}
                isSelected={selected() === summary.url}
                name={summary.name}
                depth={draftDepth(summary)}
                onRename={(name) => void onRename(summary.url, name)}
                onSelect={selectDraft}
                onScrub={(scrub) =>
                  onScrub(summary.url, summary.members, scrub)
                }
                scrubber={() =>
                  selected() === summary.url ? scrubber() : null
                }
                onBaselineScrub={(base) =>
                  onBaselineScrub(summary.url, summary.members, base)
                }
                baseliner={() =>
                  selected() === summary.url ? baseliner() : null
                }
                checkpoint={() =>
                  selected() === summary.url ? (checkedOut()?.at ?? null) : null
                }
                hasCheckpoint={selected() === summary.url && isPinned()}
                onReturnToLatest={clearCheckpoint}
                eyeOpen={selected() === summary.url && eyeOpen()}
                eyeDisabled={false}
                onToggleEye={toggleEye}
                onFork={() => void onForkSelection(false)}
                forkAtLabel={forkAtLabel()}
                onForkAt={() => void onForkSelection(true)}
                mergeLabel={`Merge into "${mergeTargetName()}"`}
                onMerge={() => void onMergeDraft()}
                onMergeHover={setMergeHighlight}
                onDelete={() => void onDeleteDraft()}
                isMergeTarget={
                  mergeHighlight() && mergeParentUrl() === summary.url
                }
              />
            )}
          </For>
        </div>
      </Show>
      <div class="drafts-version">v{DRAFTS_VERSION}</div>
    </div>
  );
}

// Merges every cloned doc back into the parent draft's copy of it — the
// parent's clone when it has one, the original otherwise (the main draft's
// identity clones make those the same thing, so a top-level draft merges
// into the originals) — recording per-clone merge heads for auditing, and
// marks the draft as merged (which hides it from the list). The merged
// draft's children are handed up to the merge target, so they never dangle
// under a hidden draft.
async function mergeDraft(
  repo: Repo,
  draftHandle: DocHandle<DraftDoc>
): Promise<void> {
  const doc = draftHandle.doc();
  const parentHandle = await findMergeTarget(repo, doc?.parent);
  const parentClones = parentHandle?.doc()?.clones ?? {};
  const entries = Object.entries(doc?.clones ?? {}) as [
    AutomergeUrl,
    CloneEntry,
  ][];
  for (const [originalUrl, entry] of entries) {
    const targetUrl = parentClones[originalUrl]?.cloneUrl ?? originalUrl;
    if (entry.cloneUrl === targetUrl) continue;
    const [target, clone] = await Promise.all([
      repo.find<unknown>(targetUrl),
      repo.find<unknown>(entry.cloneUrl),
    ]);
    target.merge(clone);
    const mergedAt = target.heads();
    draftHandle.change((d) => {
      const e = d.clones[originalUrl];
      if (e) e.mergedAt = mergedAt;
    });
  }
  draftHandle.change((d) => {
    d.mergedAt = Date.now();
  });

  // Re-parent the merged draft's children onto the merge target: they list
  // under it and their own merges land there (where this draft's changes
  // now live). Their clones branched off this draft's clones, whose history
  // was just merged into the target, so they still merge back cleanly.
  if (parentHandle) {
    const children = (draftHandle.doc()?.drafts ?? []).filter(
      isValidAutomergeUrl
    );
    for (const childUrl of children) {
      try {
        const child = await repo.find<DraftDoc>(childUrl);
        child.change((d) => {
          d.parent = parentHandle.url;
        });
        parentHandle.change((d) => {
          if (!d.drafts.includes(childUrl)) d.drafts.push(childUrl);
        });
        draftHandle.change((d) => {
          const i = d.drafts.indexOf(childUrl);
          if (i >= 0) d.drafts.splice(i, 1);
        });
      } catch (err) {
        console.warn(
          "[drafts] failed to re-parent child draft after merge:",
          childUrl,
          err
        );
      }
    }
  }
}

// Resolve the draft the merge should land in: the nearest non-merged
// ancestor. A parent that was itself merged away hands its role up the
// chain (its changes live in *its* merge target), ending at the main draft,
// which is never merged. Null when the chain can't be resolved — the caller
// then falls back to merging into the originals.
async function findMergeTarget(
  repo: Repo,
  parentUrl: AutomergeUrl | undefined
): Promise<DocHandle<DraftDoc> | null> {
  const seen = new Set<AutomergeUrl>();
  let cursor = parentUrl;
  while (cursor && isValidAutomergeUrl(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    try {
      const candidate = await repo.find<DraftDoc>(cursor);
      if (candidate.doc()?.mergedAt === undefined) return candidate;
      cursor = candidate.doc()?.parent;
    } catch (err) {
      console.warn(
        "[drafts] failed to load ancestor draft for merge; " +
          "falling back to merging into the originals:",
        cursor,
        err
      );
      return null;
    }
  }
  return null;
}

// --- Cloning a member at a version -------------------------------------------
// The obvious way — `repo.clone(handle.view(to))`, i.e. wasm `fork_at` — is
// broken upstream: on documents whose history contains certain concurrent
// merge changes (as anything synced through subduction ends up with),
// `fork_at` panics with `MissingOps` in `ChangeCollector::from_build_meta`
// at *any* heads, and the panic poisons the doc object for the rest of the
// session (every later call throws "recursive use of an object detected").
// Confirmed offline against automerge 3.3.0-fragments.1 and .2 with a
// 26-change minimal repro.
//
// So the version clone is built without `fork_at`: collect the ancestor
// closure of the pin heads from the change metadata, bundle exactly those
// changes (`saveBundle`), hydrate a fresh doc from the bundle
// (`loadIncremental`), and install it into a new repo handle — the same move
// `repo.clone` performs internally, minus the panicking wasm path. The
// resulting doc's heads are exactly `to`, it shares history with the
// original, and merges back cleanly.

// Build a clone of `handle`'s doc pinned to the `to` heads and register it
// with the repo. Throws (a plain JS error, no wasm panic) when the pin's
// ancestry can't be resolved from the doc's change metadata.
function cloneAtVersion(
  repo: Repo,
  handle: DocHandle<unknown>,
  to: UrlHeads
): DocHandle<unknown> {
  const doc = handle.doc() as Automerge.Doc<unknown>;
  const pinHeads = decodeHeads(to);

  // Ancestor closure of the pin heads, walked over the full change metadata.
  const metas = Automerge.getChangesMetaSince(doc, []);
  const byHash = new Map(metas.map((m) => [m.hash, m]));
  const closure = new Set<string>();
  const stack = [...pinHeads];
  while (stack.length > 0) {
    const hash = stack.pop()!;
    if (closure.has(hash)) continue;
    const meta = byHash.get(hash);
    if (!meta) {
      throw new Error(
        `[drafts] change ${hash} is not in the doc's history metadata`
      );
    }
    closure.add(hash);
    stack.push(...meta.deps);
  }

  const bundle = Automerge.saveBundle(doc, [...closure]);
  const pinned = Automerge.loadIncremental(Automerge.init<unknown>(), bundle);

  const gotHeads = [...Automerge.getHeads(pinned)].sort();
  const wantHeads = [...pinHeads].sort();
  if (JSON.stringify(gotHeads) !== JSON.stringify(wantHeads)) {
    throw new Error(
      `[drafts] version clone heads mismatch: wanted ${wantHeads}, got ${gotHeads}`
    );
  }

  const clone = repo.create<unknown>();
  clone.update(() => pinned);
  return clone;
}

// --- Fork-at-version diagnostics --------------------------------------------
// When `cloneAtVersion` fails, everything we can learn about the member and
// the pinned heads is dumped as one JSON block tagged
// [drafts][fork-diagnostic]; paste that back when reporting.

// Everything we could learn about the member and the pinned heads, plus the
// final error.
type ForkDiagnostic = {
  draftsVersion: string;
  memberUrl: AutomergeUrl;
  sourceUrl: AutomergeUrl;
  memberClonedAt: UrlHeads | null;
  // The version being forked at, as url-encoded heads and as hex hashes.
  to: UrlHeads;
  toHex: string[];
  // The doc's live frontier (hex), for comparison with `toHex`.
  currentHeads: string[] | null;
  // Does the doc itself consider `toHex` a valid point in its history?
  hasHeads: boolean | null;
  // Change hashes the doc knows it is missing ops for, as of `toHex`.
  missingDeps: string[] | null;
  stats: { numChanges: number; numOps: number } | null;
  automerge: {
    jsGitHead: string;
    wasmGitHead: string | null;
    wasmVersion: string | null;
  } | null;
  // Where each pinned hash sits in the doc's history: its topological index,
  // metadata, and whether it is a live head. `known: false` means the doc has
  // no change with that hash at all.
  pinnedChanges: {
    hash: string;
    known: boolean;
    topoIndex: number | null;
    time: number | null;
    actor: string | null;
    seq: number | null;
    deps: string[] | null;
    isCurrentHead: boolean;
  }[];
  // Sedimentree fragment coverage: how the doc's history is bundled.
  // `topoRange` is the [min, max] topological index of the fragment's member
  // changes and `containsPin` whether a pinned hash is one of them — so a
  // fork-depth failure boundary can be read directly against bundle
  // boundaries. A pinned hash buried inside a higher-level bundle is the
  // prime MissingOps suspect.
  fragments:
    | {
        level: number;
        head: string;
        memberCount: number;
        topoRange: [number, number] | null;
        containsPin: boolean;
      }[]
    | null;
  probeErrors: string[];
  failure?: { message: string; stack?: string };
};

// The saved doc bytes captured before the failing fork, kept out of the JSON
// report (too big) and exposed on `window.__draftsForkRepro` instead, so the
// exact failing document can be reproduced offline.
type ForkRepro = {
  url: AutomergeUrl;
  toHex: string[];
  docBase64: string;
};

// Snapshot everything we can read about `handle`'s doc and the pinned heads.
// Every probe is individually guarded so one bad call doesn't lose the rest.
function collectForkDiagnostic(
  handle: DocHandle<unknown>,
  member: DraftMemberDoc,
  to: UrlHeads
): ForkDiagnostic {
  const diagnostic: ForkDiagnostic = {
    draftsVersion: DRAFTS_VERSION,
    memberUrl: member.url,
    sourceUrl: member.cloneUrl ?? member.url,
    memberClonedAt: member.clonedAt,
    to,
    toHex: [],
    currentHeads: null,
    hasHeads: null,
    missingDeps: null,
    stats: null,
    automerge: null,
    pinnedChanges: [],
    fragments: null,
    probeErrors: [],
  };
  const probe = (name: string, run: () => void) => {
    try {
      run();
    } catch (err) {
      diagnostic.probeErrors.push(`${name}: ${String(err)}`);
    }
  };

  probe("decodeHeads", () => {
    diagnostic.toHex = decodeHeads(to);
  });

  const doc = handle.doc() as Automerge.Doc<unknown>;

  probe("getHeads", () => {
    diagnostic.currentHeads = Automerge.getHeads(doc);
  });
  probe("hasHeads", () => {
    diagnostic.hasHeads = Automerge.hasHeads(doc, diagnostic.toHex);
  });
  probe("getMissingDeps", () => {
    diagnostic.missingDeps = Automerge.getMissingDeps(doc, diagnostic.toHex);
  });
  probe("stats", () => {
    const s = Automerge.stats(doc);
    diagnostic.stats = { numChanges: s.numChanges, numOps: s.numOps };
  });
  probe("releaseInfo", () => {
    const info = Automerge.releaseInfo();
    diagnostic.automerge = {
      jsGitHead: info.js.gitHead,
      wasmGitHead: info.wasm?.gitHead ?? null,
      wasmVersion: info.wasm?.cargoPackageVersion ?? null,
    };
  });
  probe("pinnedChanges", () => {
    const topo = Automerge.topoHistoryTraversal(doc);
    const metas = Automerge.getChangesMetaSince(doc, []);
    const metaByHash = new Map(metas.map((m) => [m.hash, m]));
    diagnostic.pinnedChanges = diagnostic.toHex.map((hash) => {
      const meta = metaByHash.get(hash);
      const topoIndex = topo.indexOf(hash);
      return {
        hash,
        known: !!meta || topoIndex >= 0,
        topoIndex: topoIndex >= 0 ? topoIndex : null,
        time: meta?.time ?? null,
        actor: meta?.actor ?? null,
        seq: meta?.seq ?? null,
        deps: meta?.deps ?? null,
        isCurrentHead: diagnostic.currentHeads?.includes(hash) ?? false,
      };
    });
  });
  probe("fragments", () => {
    const topo = Automerge.topoHistoryTraversal(doc);
    const topoIndex = new Map(topo.map((h, i) => [h, i]));
    const pinned = new Set(diagnostic.toHex);
    diagnostic.fragments = Automerge.getFragmentMetadata(doc).map((f) => {
      let min = Infinity;
      let max = -Infinity;
      let containsPin = false;
      for (const h of f.members) {
        const i = topoIndex.get(h);
        if (i !== undefined) {
          if (i < min) min = i;
          if (i > max) max = i;
        }
        if (pinned.has(h)) containsPin = true;
      }
      return {
        level: f.level,
        head: f.head,
        memberCount: f.members.length,
        topoRange: min <= max ? ([min, max] as [number, number]) : null,
        containsPin,
      };
    });
  });
  probe("saveDoc", () => {
    // Capture the full doc bytes for an offline repro; published to
    // `window.__draftsForkRepro` by `reportForkFailure`.
    const bytes = Automerge.save(doc);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    lastForkRepro = {
      url: member.url,
      toHex: diagnostic.toHex,
      docBase64: btoa(binary),
    };
  });

  return diagnostic;
}

// The most recent member's saved bytes, captured by `collectForkDiagnostic`
// and published by `reportForkFailure` when its member's fork fails.
let lastForkRepro: ForkRepro | null = null;

// Dump the diagnostic and the error as one copy-pasteable JSON block.
function reportForkFailure(
  diagnostic: ForkDiagnostic | null,
  err: unknown
): void {
  const failure = {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  };
  if (!diagnostic) {
    console.error(
      "[drafts][fork-diagnostic] failed before diagnostics could be gathered:",
      failure
    );
    return;
  }
  diagnostic.failure = failure;
  if (lastForkRepro && lastForkRepro.url === diagnostic.memberUrl) {
    (window as unknown as Record<string, unknown>).__draftsForkRepro =
      lastForkRepro;
  }
  console.error(
    "[drafts][fork-diagnostic] failed to fork member at version — paste this block back:\n" +
      JSON.stringify(diagnostic, null, 2) +
      "\n[drafts][fork-diagnostic] the failing doc's bytes are on " +
      "window.__draftsForkRepro — to save them for an offline repro, run:\n" +
      "  const r = window.__draftsForkRepro;\n" +
      "  const bytes = Uint8Array.from(atob(r.docBase64), c => c.charCodeAt(0));\n" +
      "  const a = document.createElement('a');\n" +
      "  a.href = URL.createObjectURL(new Blob([bytes]));\n" +
      "  a.download = 'fork-repro.automerge'; a.click();\n" +
      "  console.log('pin heads:', r.toHex);"
  );
}

function MainCard(props: {
  hostDocUrl: AutomergeUrl | undefined;
  isSelected: boolean;
  members: Accessor<DraftMemberDoc[]>;
  changeGroupDocUrl: AutomergeUrl | null;
  name: string | null;
  onRename: (name: string | null) => void;
  onSelect: () => void;
  onScrub: (scrub: ScrubberState) => void;
  scrubber: Accessor<ScrubberState | null>;
  onBaselineScrub: (base: BaselineState) => void;
  baseliner: Accessor<BaselineState | null>;
  checkpoint: Accessor<DraftCheckpoint | null>;
  hasCheckpoint: boolean;
  onReturnToLatest: () => void;
  eyeOpen: boolean;
  eyeDisabled: boolean;
  onToggleEye: () => void;
  forkDisabled: boolean;
  onFork: () => void;
  forkAtLabel: string | null;
  onForkAt: () => void;
  // True while the merge menu item is hovered and this card is the target.
  isMergeTarget: boolean;
}) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  return (
    <div
      class="draft-card"
      data-selected={props.isSelected ? "" : undefined}
      data-menu-open={menuOpen() ? "" : undefined}
      data-merge-target={props.isMergeTarget ? "" : undefined}
    >
      {/* A div, not a <button>: the rename input rendered inside would be
          invalid (and misbehave) nested in a button. */}
      <div
        class="draft-card-header"
        onClick={props.onSelect}
        title="Main version (host document)"
      >
        <div class="draft-card-title">
          <DraftName
            name={props.name}
            fallback="Main"
            onRename={props.onRename}
          />
          {/* Shown left of the tools while the timeline is pinned: drops the
              pin and returns to the live latest heads. It lives inside the
              clickable header, so the click is stopped from also
              re-selecting the card. */}
          <Show when={props.hasCheckpoint}>
            <button
              type="button"
              class="draft-card-return"
              onClick={(e) => {
                e.stopPropagation();
                props.onReturnToLatest();
              }}
              title="Return to the latest version"
            >
              Return to latest
            </button>
          </Show>
          <Show when={props.isSelected}>
            <span class="draft-card-tools">
              <EyeToggle
                open={props.eyeOpen}
                disabled={props.eyeDisabled}
                onToggle={props.onToggleEye}
              />
              <CardMenu
                forkDisabled={props.forkDisabled}
                onFork={props.onFork}
                forkAtLabel={props.forkAtLabel}
                onForkAt={props.onForkAt}
                onOpenChange={setMenuOpen}
              />
            </span>
          </Show>
        </div>
      </div>
      <Show when={props.isSelected}>
        <DraftChangesList
          members={props.members}
          changeGroupDocUrl={props.changeGroupDocUrl}
          mainDocUrl={props.hostDocUrl}
          onScrub={props.onScrub}
          scrubber={props.scrubber}
          onBaselineScrub={props.onBaselineScrub}
          baseliner={props.baseliner}
          eyeOpen={() => props.eyeOpen}
          checkpoint={props.checkpoint}
          onReturnToLatest={props.onReturnToLatest}
        />
      </Show>
    </div>
  );
}

function DraftCard(props: {
  url: AutomergeUrl;
  members: DraftMemberDoc[];
  changeGroupDocUrl: AutomergeUrl | null;
  mainDocUrl: AutomergeUrl | undefined;
  isSelected: boolean;
  name: string | null;
  // Nesting depth below main (0 = top-level draft); indents the card so a
  // fork reads as a child of the card above it. Rendering adds one level so
  // every draft — main's children included — sits indented under the Main
  // card.
  depth: number;
  onRename: (name: string | null) => void;
  onSelect: (url: AutomergeUrl) => void;
  onScrub: (scrub: ScrubberState) => void;
  scrubber: Accessor<ScrubberState | null>;
  onBaselineScrub: (base: BaselineState) => void;
  baseliner: Accessor<BaselineState | null>;
  checkpoint: Accessor<DraftCheckpoint | null>;
  hasCheckpoint: boolean;
  onReturnToLatest: () => void;
  eyeOpen: boolean;
  eyeDisabled: boolean;
  onToggleEye: () => void;
  onFork: () => void;
  forkAtLabel: string | null;
  onForkAt: () => void;
  // Menu item text naming the merge target (this draft's parent, e.g.
  // `Merge into "Main"`); merging goes up.
  mergeLabel: string;
  onMerge: () => void;
  // Fires with true/false as the merge item is hovered/left, so the parent
  // card can light up as the target.
  onMergeHover: (over: boolean) => void;
  // True while the merge menu item is hovered and this card is the target.
  isMergeTarget: boolean;
  // Unlinks the draft (and its forks) from the tree, after a confirm dialog.
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  return (
    <div
      class="draft-card"
      data-selected={props.isSelected ? "" : undefined}
      data-menu-open={menuOpen() ? "" : undefined}
      data-merge-target={props.isMergeTarget ? "" : undefined}
      style={{ "margin-left": `${Math.min(props.depth + 1, 5)}rem` }}
    >
      {/* A div, not a <button>: see MainCard. */}
      <div
        class="draft-card-header"
        onClick={() => props.onSelect(props.url)}
        title="Open draft"
      >
        <div class="draft-card-title">
          <DraftName
            name={props.name}
            fallback="Draft"
            onRename={props.onRename}
          />
          {/* See MainCard: pinned-only "return to latest" control in the title. */}
          <Show when={props.hasCheckpoint}>
            <button
              type="button"
              class="draft-card-return"
              onClick={(e) => {
                e.stopPropagation();
                props.onReturnToLatest();
              }}
              title="Return to the latest version"
            >
              Return to latest
            </button>
          </Show>
          <Show when={props.isSelected}>
            <span class="draft-card-tools">
              <EyeToggle
                open={props.eyeOpen}
                disabled={props.eyeDisabled}
                onToggle={props.onToggleEye}
              />
              <CardMenu
                onFork={props.onFork}
                forkAtLabel={props.forkAtLabel}
                onForkAt={props.onForkAt}
                merge={{
                  label: props.mergeLabel,
                  onMerge: props.onMerge,
                  onHoverTarget: props.onMergeHover,
                }}
                onDelete={props.onDelete}
                onOpenChange={setMenuOpen}
              />
            </span>
          </Show>
        </div>
      </div>
      <Show when={props.isSelected}>
        <DraftChangesList
          members={() => props.members}
          changeGroupDocUrl={props.changeGroupDocUrl}
          mainDocUrl={props.mainDocUrl}
          onScrub={props.onScrub}
          scrubber={props.scrubber}
          onBaselineScrub={props.onBaselineScrub}
          baseliner={props.baseliner}
          eyeOpen={() => props.eyeOpen}
          checkpoint={props.checkpoint}
          onReturnToLatest={props.onReturnToLatest}
        />
      </Show>
    </div>
  );
}

// The "⋯" context menu in a selected card's title. Items: fork at the
// latest heads, fork from the scrubbed version (only while the timeline is
// pinned), and — on draft cards — merge up into the parent. Hovering the
// merge item highlights the target card via `onHoverTarget`. The dropdown
// is anchored to the trigger; `onOpenChange` mirrors the open state up so
// the card can lift its overflow clipping while the list is showing.
function CardMenu(props: {
  forkDisabled?: boolean;
  onFork: () => void;
  // "Fork from Jul 24, 3:12 PM" while pinned; null hides the item.
  forkAtLabel: string | null;
  onForkAt: () => void;
  // Draft cards only: the merge-up item.
  merge?: {
    label: string;
    onMerge: () => void;
    onHoverTarget: (over: boolean) => void;
  };
  // Draft cards only: the delete item (confirmed via a dialog in the
  // handler).
  onDelete?: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpenSignal] = createSignal(false);
  const setOpen = (v: boolean) => {
    setOpenSignal(v);
    props.onOpenChange(v);
    if (!v) props.merge?.onHoverTarget(false);
  };
  // The menu unmounts with its card's selection; reset what was mirrored up.
  onCleanup(() => setOpen(false));

  createEffect(() => {
    if (!open()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  // Every item click: don't bubble into the header's select, close, run.
  const pick = (e: MouseEvent, action: () => void) => {
    e.stopPropagation();
    setOpen(false);
    action();
  };

  return (
    <span class="draft-menu">
      <button
        type="button"
        class="draft-card-action"
        data-active={open() ? "" : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open());
        }}
        title="Draft actions"
      >
        <EllipsisIcon />
      </button>
      <Show when={open()}>
        {/* Invisible click-catcher behind the list: any click outside the
            items closes the menu without doing anything else. */}
        <div
          class="draft-menu-backdrop"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
        />
        <div class="draft-menu-list">
          <button
            type="button"
            class="draft-menu-item"
            disabled={props.forkDisabled}
            title={
              props.forkDisabled
                ? "Drafts aren't supported for folders yet"
                : "Fork a new draft from the latest version"
            }
            onClick={(e) => pick(e, props.onFork)}
          >
            <GitBranchIcon />
            Fork
          </button>
          <Show when={props.forkAtLabel}>
            {(label) => (
              <button
                type="button"
                class="draft-menu-item"
                title="Fork a new draft from the version you're viewing"
                onClick={(e) => pick(e, props.onForkAt)}
              >
                <HistoryIcon />
                {label()}
              </button>
            )}
          </Show>
          <Show when={props.merge}>
            {(merge) => (
              <>
                <div class="draft-menu-separator" />
                <button
                  type="button"
                  class="draft-menu-item"
                  title="Merge this draft into the highlighted card and hide it"
                  onClick={(e) => pick(e, merge().onMerge)}
                  onMouseEnter={() => merge().onHoverTarget(true)}
                  onMouseLeave={() => merge().onHoverTarget(false)}
                >
                  <GitMergeIcon />
                  {merge().label}
                </button>
              </>
            )}
          </Show>
          <Show when={props.onDelete}>
            {(onDelete) => (
              <>
                <div class="draft-menu-separator" />
                <button
                  type="button"
                  class="draft-menu-item draft-menu-item--danger"
                  title="Deletes this draft and any drafts forked from it"
                  onClick={(e) => pick(e, onDelete())}
                >
                  <TrashIcon />
                  Delete draft
                </button>
              </>
            )}
          </Show>
        </div>
      </Show>
    </span>
  );
}

// "Jul 24, 3:12 PM" (with the year when it isn't the current one), for the
// fork-from-version menu item. Takes an Automerge change time (Unix SECONDS).
function formatVersionTime(timeSeconds: number): string {
  const date = new Date(timeSeconds * 1000);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function GitBranchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function GitMergeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}

function EllipsisIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

// A clock rewinding: the fork-from-a-past-version item.
function HistoryIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

// A card's display name. Double-click to rename inline: Enter or clicking
// away commits, Escape cancels, and committing an empty value clears the
// name back to the default label.
function DraftName(props: {
  name: string | null;
  fallback: string;
  onRename: (name: string | null) => void;
}) {
  const [editing, setEditing] = createSignal(false);
  return (
    <Show
      when={editing()}
      fallback={
        <span
          class="draft-name"
          title="Double-click to rename"
          onDblClick={() => setEditing(true)}
        >
          {props.name ?? props.fallback}
        </span>
      }
    >
      <input
        class="draft-name-input"
        value={props.name ?? ""}
        placeholder={props.fallback}
        // Focus once mounted; the ref fires before insertion, hence the tick.
        ref={(el) => setTimeout(() => el.select())}
        onClick={(e) => e.stopPropagation()}
        onDblClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={(e) => {
          if (!editing()) return; // already cancelled via Escape
          setEditing(false);
          const value = e.currentTarget.value.trim();
          if (value !== (props.name ?? "")) props.onRename(value || null);
        }}
      />
    </Show>
  );
}

// The diff toggle in a card title, right-aligned. Open = diff highlighting
// showing. It holds no state: open/closed is derived from the checkpoint's
// baselines and toggling rewrites them (see `toggleEye`). Disabled on a live
// main view, where there is nothing to diff against — via aria-disabled
// rather than the disabled attribute, so the explanatory tooltip still shows
// on hover (browsers don't reliably show titles on disabled buttons).
function EyeToggle(props: {
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      class="draft-card-eye"
      data-active={props.open ? "" : undefined}
      data-disabled={props.disabled ? "" : undefined}
      aria-disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (props.disabled) return;
        props.onToggle();
      }}
      title={
        props.disabled
          ? "Nothing to compare yet — select a version in the timeline first"
          : props.open
            ? "Hide changes"
            : "Show what changed"
      }
    >
      <Show when={props.open} fallback={<EyeOffIcon />}>
        <EyeIcon />
      </Show>
    </button>
  );
}

function EyeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// A reference to one change in the interleaved timeline, by document and
// hash. `time` steers how the *other* member docs' heads are resolved around
// it (see `computeCheckpoint`).
type ChangeRef = {
  docUrl: AutomergeUrl;
  hash: string;
  time: number;
};

// Where the scrubber sits: the change whose heads the view displays,
// anchored to its persisted group. `offset` is the change's position within the
// group, 0 = the group's newest change (what the scrubber geometry snaps
// to); `head` identifies the exact change for the checkpoint machinery.
// `groupStartTime` is the group's span start, carried so the checkpoint's
// diff baseline can anchor at the group's beginning while the eye is on.
type ScrubberState = {
  groupId: string;
  offset: number;
  head: ChangeRef;
  groupStartTime: number;
};

// Where the diff baseline handle sits: an absolute point in history the diff
// is measured from, independent of the head. `time` resolves each member's
// `from` (see `computeCheckpoint`); `groupId`/`offset` place the handle in the
// track (same geometry as the head). `offset` of `BASELINE_GROUP_START` means
// "the start of the group" — the changes list resolves it to the group's
// oldest change once it knows the group's size. Ephemeral like `ScrubberState`.
type BaselineState = {
  groupId: string;
  offset: number;
  time: number;
};

// Sentinel `BaselineState.offset` meaning "the group's start" (its oldest
// change / the bottom of its band), used when the eye seeds the handle before
// the group's change count is known.
const BASELINE_GROUP_START = -1;

// One change recovered by the on-demand scrub-resolution scan. `doc` is the
// member doc it was read from (kept so the sticker can diff it on demand);
// `seq` is the change's per-document causal index, used only to break
// same-second timestamp ties — matching the ChangeGrouper's interleave order.
type ScanChange = {
  docUrl: AutomergeUrl;
  doc: Automerge.Doc<unknown>;
  hash: string;
  time: number;
  deps: string[];
  seq: number;
};

// Renders a draft's (or main's) timeline straight from its ChangeGroupDoc.
// The ChangeGrouper computes and persists activity groups (newest first, older
// history backfilling), and this component is a pure reader: it paints before
// the member docs even load, and live edits arrive through the group doc's
// change signal. A gutter on
// the left spans the whole history (top = latest version, bottom = first);
// the indicator — a calendar-style dot + line — marks the version being
// looked at and paints *on top* of everything in the changes area.
// Dragging starts only from its handles in the gutter; dragging it all the
// way to the top returns to the latest version (`onReturnToLatest`). While
// pinned, a sticker overlays the row at the head with the exact change the
// line sits on. Individual changes are NOT cached: scrub positions resolve
// on demand by scanning the member docs' change metadata inside the group's
// time span (no diffs), memoized per group so dragging stays snappy.
function DraftChangesList(props: {
  members: Accessor<DraftMemberDoc[]>;
  changeGroupDocUrl: AutomergeUrl | null;
  mainDocUrl: AutomergeUrl | undefined;
  onScrub: (scrub: ScrubberState) => void;
  scrubber: Accessor<ScrubberState | null>;
  onBaselineScrub: (base: BaselineState) => void;
  baseliner: Accessor<BaselineState | null>;
  eyeOpen: Accessor<boolean>;
  // The live checkpoint (`CheckedOutDraft.at`): per-member `to`/`from`
  // heads, read for the sticker's whole-range diff counts.
  checkpoint: Accessor<DraftCheckpoint | null>;
  onReturnToLatest: () => void;
}) {
  const repo = "repo" in window ? window.repo : undefined;

  // The group doc is read live, so ChangeGrouper writes stream in as rows.
  const [changeGroupHandle, setChangeGroupHandle] =
    createSignal<DocHandle<ChangeGroupDoc>>();
  createEffect(() => {
    const url = props.changeGroupDocUrl;
    setChangeGroupHandle(undefined);
    if (!url || !repo) return;
    let disposed = false;
    void repo.find<ChangeGroupDoc>(url).then(
      (handle) => {
        if (!disposed) setChangeGroupHandle(handle);
      },
      (err) => {
        console.warn("[drafts] failed to load change-group doc:", url, err);
      }
    );
    onCleanup(() => {
      disposed = true;
    });
  });
  const changeGroupDoc = createDocSignal(changeGroupHandle);

  // The rendered groups, newest-first. Metadata-only groups are retained so
  // the ChangeGrouper can extend the newest one, but filtered from the UI.
  const timeGroups = createMemo<ChangeGroup[]>(() =>
    Object.values(changeGroupDoc()?.groups ?? {})
      .filter((g) => g.additions > 0 || g.deletions > 0)
      .sort((a, b) => b.endTime - a.endTime || (a.id < b.id ? -1 : 1))
  );

  // Member doc handles (plus the creation-time cutoff), resolved once per
  // member set — only needed to *scrub*, never to render the rows.
  type MemberSource = { member: DraftMemberDoc; handle: DocHandle<unknown> };
  const [sources, setSources] = createSignal<MemberSource[] | null>(null);
  const [createdAt, setCreatedAt] = createSignal<number | undefined>(
    undefined
  );
  createEffect(() => {
    const list = props.members();
    const mainDocUrl = props.mainDocUrl;
    if (!repo) return;
    let disposed = false;
    setSources(null);
    void (async () => {
      const next: MemberSource[] = [];
      for (const member of list) {
        try {
          const handle = await repo.find<unknown>(
            member.cloneUrl ?? member.url
          );
          next.push({ member, handle });
        } catch (err) {
          console.warn(
            "[drafts] failed to resolve member for scrubbing:",
            member,
            err
          );
        }
      }
      const created = await getDocCreationTime(repo, mainDocUrl);
      if (disposed) return;
      setCreatedAt(created);
      setSources(next);
    })();
    onCleanup(() => {
      disposed = true;
    });
  });

  // Grouping is caught up when every member's live heads match the group
  // doc's consumed marker (`computedThrough` — written only when a pass
  // completes, while groups flush incrementally during it). A running build
  // keeps writing to the group doc, so this re-evaluates live; it also reads
  // true while another peer does the building, since the group doc syncs.
  // Checkpoint pins don't interfere: they bake heads onto overlay urls, the
  // handles here always sit at the live frontier.
  const isBuilding = createMemo<boolean>(() => {
    const consumed = changeGroupDoc()?.computedThrough ?? {};
    const srcs = sources();
    if (!srcs || srcs.length === 0) return false;
    return srcs.some(({ member, handle }) => {
      const heads = handle.heads();
      return heads ? !sameHeads(heads, consumed[member.url]) : false;
    });
  });

  // Recover a group's member changes on demand: scan each member's post-fork
  // change metadata filtered to the group's span (spans are disjoint — groups
  // are separated by >gap lulls, so time containment recovers exactly the
  // group's changes) and interleave with the ChangeGrouper's ordering.
  // Metadata only, no diffs. Memoized per group identity so dragging
  // stays snappy; returns null until the member handles resolve. It must apply
  // the same filters as grouping (notably the pre-creation cutoff), or the
  // scrubber's index math drifts from the persisted changeCount.
  const scanCache = new Map<string, ScanChange[]>();
  const resolveGroupChanges = (group: ChangeGroup): ScanChange[] | null => {
    const key = `${group.id}:${group.changeCount}`;
    const hit = scanCache.get(key);
    if (hit) return hit;
    const srcs = sources();
    if (!srcs) return null;
    const cutoff = createdAt();
    const rows: ScanChange[] = [];
    for (const { member, handle } of srcs) {
      const doc = handle.doc() as Automerge.Doc<unknown> | undefined;
      if (!doc) continue;
      try {
        const since = member.clonedAt ? decodeHeads(member.clonedAt) : [];
        const metas = Automerge.getChangesMetaSince(doc, since);
        metas.forEach((meta, seq) => {
          if (cutoff !== undefined && meta.time && meta.time < cutoff) return;
          if (meta.time < group.startTime || meta.time > group.endTime) return;
          rows.push({
            docUrl: member.url,
            doc,
            hash: meta.hash,
            time: meta.time,
            deps: meta.deps,
            seq,
          });
        });
      } catch (err) {
        console.warn(
          "[drafts] failed to scan changes for member:",
          member,
          err
        );
      }
    }
    rows.sort((a, b) => b.time - a.time || b.seq - a.seq);
    scanCache.set(key, rows);
    return rows;
  };

  // Build the head scrub state for `offset` within `group` (0 = the group's
  // newest change, which the group doc anchors directly; deeper offsets resolve
  // through the on-demand scan). Null while the scan is still resolving.
  const buildHead = (
    group: ChangeGroup,
    offset: number
  ): ScrubberState | null => {
    if (offset <= 0) {
      return {
        groupId: group.id,
        offset: 0,
        head: {
          docUrl: group.newestMemberUrl,
          hash: group.newestHash,
          time: group.endTime,
        },
        groupStartTime: group.startTime,
      };
    }
    const rows = resolveGroupChanges(group);
    if (!rows || rows.length === 0) return null;
    const row = rows[Math.min(offset, rows.length - 1)];
    return {
      groupId: group.id,
      offset,
      head: { docUrl: row.docUrl, hash: row.hash, time: row.time },
      groupStartTime: group.startTime,
    };
  };

  // Expand the BASELINE_GROUP_START sentinel to the group's oldest change.
  const resolveOffset = (group: ChangeGroup, offset: number): number =>
    offset === BASELINE_GROUP_START
      ? Math.max(0, group.changeCount - 1)
      : offset;

  // The change time at `offset` within `group` (0 = the group's newest
  // change). Used to resolve the baseline handle's `from` time.
  const timeAt = (group: ChangeGroup, offset: number): number => {
    const resolved = resolveOffset(group, offset);
    if (resolved <= 0) return group.endTime;
    const rows = resolveGroupChanges(group);
    if (!rows || rows.length === 0) return group.startTime;
    return rows[Math.min(resolved, rows.length - 1)].time;
  };

  // A position's rank in the flat change order (higher = older), so the head
  // and baseline can be compared for clamping. Offsets are resolved (sentinel
  // -> group start) and clamped within their group.
  const linearIndex = (groupId: string, offset: number): number => {
    let acc = 0;
    for (const b of bands()) {
      const count = Math.max(1, b.group.changeCount);
      if (b.group.id === groupId) {
        return acc + Math.min(Math.max(0, resolveOffset(b.group, offset)), count - 1);
      }
      acc += count;
    }
    return acc + Math.max(0, offset);
  };

  // Move the head to `offset` within `group`. With the eye open the baseline
  // stays put (absolute), except that dragging the head older than the
  // baseline pushes the baseline down with it — they can meet but not cross.
  // The baseline is pushed first so the diff never momentarily inverts.
  const scrubTo = (group: ChangeGroup, offset: number) => {
    const head = buildHead(group, offset);
    if (!head) return;
    if (props.eyeOpen()) {
      const bl = props.baseliner();
      if (
        bl &&
        linearIndex(head.groupId, head.offset) >
          linearIndex(bl.groupId, bl.offset)
      ) {
        props.onBaselineScrub({
          groupId: group.id,
          offset: head.offset,
          time: head.head.time,
        });
      }
    }
    props.onScrub(head);
  };

  // Select a group (click on its row): the head pins to the group's newest
  // change, and — with the eye open — the baseline re-anchors to the group's
  // start, so the diff reads "everything this group changed". Dragging the
  // head, by contrast, leaves the baseline where it is (see `scrubTo`).
  const selectGroup = (group: ChangeGroup) => {
    if (props.eyeOpen()) {
      props.onBaselineScrub({
        groupId: group.id,
        offset: BASELINE_GROUP_START,
        time: group.startTime,
      });
    }
    scrubTo(group, 0);
  };

  // Move the baseline to `offset` within `group`, clamped so it never crosses
  // above (newer than) the head — the diff always reads old -> new. When the
  // clamp bites, the baseline snaps to the head (an empty diff).
  const baselineScrubTo = (group: ChangeGroup, offset: number) => {
    const head = props.scrubber();
    if (!head) return;
    if (linearIndex(group.id, offset) < linearIndex(head.groupId, head.offset)) {
      props.onBaselineScrub({
        groupId: head.groupId,
        offset: head.offset,
        time: head.head.time,
      });
      return;
    }
    props.onBaselineScrub({
      groupId: group.id,
      offset,
      time: timeAt(group, offset),
    });
  };

  // The group the scrubber head sits in: by group identity when it still
  // exists, falling back to span containment (an extended group gets a new
  // id, but its span still covers the pinned change).
  const groupForScrub = (s: ScrubberState): ChangeGroup | null =>
    timeGroups().find((g) => g.id === s.groupId) ??
    timeGroups().find(
      (g) => s.head.time >= g.startTime && s.head.time <= g.endTime
    ) ??
    null;

  // --- Scrubber geometry ---------------------------------------------------
  // The track mirrors the rows column: each group row is one vertical band,
  // and the group's changes distribute evenly across the band's height, so
  // every individual change — including ones in the middle of a group — is a
  // valid stop for the token, not just group boundaries.
  const rowEls = new Map<string, HTMLElement>();
  const [rowsEl, setRowsEl] = createSignal<HTMLDivElement>();
  // Bumped after layout changes so `bands` re-measures the rendered rows.
  const [measureTick, setMeasureTick] = createSignal(0);

  createEffect(() => {
    const el = rowsEl();
    if (!el) return;
    const observer = new ResizeObserver(() => setMeasureTick((t) => t + 1));
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  // Rows render after the groups memo recomputes, so measure again on the
  // next frame once the DOM has settled.
  createEffect(() => {
    timeGroups();
    requestAnimationFrame(() => setMeasureTick((t) => t + 1));
  });

  type Band = {
    group: ChangeGroup;
    top: number;
    height: number;
  };
  const bands = createMemo<Band[]>(() => {
    measureTick();
    const out: Band[] = [];
    for (const group of timeGroups()) {
      const el = rowEls.get(group.id);
      if (el) {
        out.push({ group, top: el.offsetTop, height: el.offsetHeight });
      }
    }
    return out;
  });

  // A scrub position's y in the track: offsets interpolate across their
  // group's band, sized by the persisted changeCount (the flat change list is
  // never materialized).
  const yForPosition = (band: Band, offset: number): number => {
    const count = Math.max(1, band.group.changeCount);
    return band.top + (Math.min(offset, count - 1) / count) * band.height;
  };

  // Inverse: the (group, offset) position nearest a pointer y (in track
  // coordinates).
  const positionForY = (
    y: number
  ): { group: ChangeGroup; offset: number } | null => {
    const bs = bands();
    if (bs.length === 0) return null;
    for (const b of bs) {
      if (y < b.top) return { group: b.group, offset: 0 };
      if (y < b.top + b.height) {
        const count = Math.max(1, b.group.changeCount);
        const offset = Math.min(
          Math.round(((y - b.top) / b.height) * count),
          count - 1
        );
        return { group: b.group, offset };
      }
    }
    const last = bs[bs.length - 1];
    return {
      group: last.group,
      offset: Math.max(0, last.group.changeCount - 1),
    };
  };

  // The indicator's pixel position: the head line's y in the track. The
  // zero-height box is fine — the dot and line overflow it and stay
  // grabbable. With nothing pinned it idles at the very top — you're looking
  // at the live latest.
  const tokenGeometry = createMemo(() => {
    const bs = bands();
    if (bs.length === 0) return null;
    const s = props.scrubber();
    if (!s) return { top: bs[0].top };
    const group = groupForScrub(s);
    const band = group ? bs.find((b) => b.group.id === group.id) : undefined;
    if (!band) return { top: bs[0].top };
    return { top: yForPosition(band, s.offset) };
  });

  // The baseline handle's y in the track, or null when it should not show:
  // only while the eye is open and a version is pinned (a head is set). Idle
  // on the latest version there is no baseline to drag.
  const baselineGeometry = createMemo(() => {
    if (!props.eyeOpen() || !props.scrubber()) return null;
    const b = props.baseliner();
    if (!b) return null;
    const bs = bands();
    const band =
      bs.find((x) => x.group.id === b.groupId) ??
      bs.find((x) => b.time >= x.group.startTime && b.time <= x.group.endTime);
    if (!band) return null;
    return { top: yForPosition(band, resolveOffset(band.group, b.offset)) };
  });

  let trackEl: HTMLDivElement | undefined;

  // Pointer y relative to the track's top edge. The rect is re-read per event
  // so scrolling the card mid-drag stays accurate.
  const yInTrack = (ev: PointerEvent): number => {
    const rect = trackEl!.getBoundingClientRect();
    return ev.clientY - rect.top;
  };

  // Begin an indicator drag: the head follows the pointer. Grabbing one of
  // the indicator's own handles (dot, line) keeps the grab point under the
  // pointer; pressing the bare gutter (`jumpToPointer`) lands the head where
  // you pressed and scrubs from there. The rows themselves don't scrub.
  // Every position snaps to an individual change, so the indicator can rest
  // anywhere in history — between groups or in the middle of one. Dragging
  // all the way to the top (the newest change) means "return to the latest
  // version": it drops the pin rather than freezing at the newest change.
  const beginDrag = (ev: PointerEvent, jumpToPointer = false) => {
    if (!trackEl || bands().length === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const grabOffset = jumpToPointer
      ? 0
      : yInTrack(ev) - (tokenGeometry()?.top ?? 0);

    const s = props.scrubber();
    let last = s ? `${s.groupId}:${s.offset}` : null;
    const onMove = (e: PointerEvent) => {
      const pos = positionForY(yInTrack(e) - grabOffset);
      if (!pos) return;
      const key = `${pos.group.id}:${pos.offset}`;
      if (key === last) return;
      last = key;
      const first = bands()[0];
      if (first && pos.group.id === first.group.id && pos.offset === 0) {
        props.onReturnToLatest();
      } else {
        scrubTo(pos.group, pos.offset);
      }
    };
    // A gutter press must land before any movement, so a plain click jumps.
    if (jumpToPointer) onMove(ev);

    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  // Begin a baseline-handle drag: the baseline follows the pointer, clamped so
  // it never crosses above the head (see `baselineScrubTo`). Unlike the head,
  // it has no return-to-latest gesture — the baseline is only meaningful while
  // pinned, so there is nowhere at the top to drop it.
  const beginBaselineDrag = (ev: PointerEvent) => {
    if (!trackEl || bands().length === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const grabOffset = yInTrack(ev) - (baselineGeometry()?.top ?? 0);

    let last: string | null = null;
    const onMove = (e: PointerEvent) => {
      const pos = positionForY(yInTrack(e) - grabOffset);
      if (!pos) return;
      const key = `${pos.group.id}:${pos.offset}`;
      if (key === last) return;
      last = key;
      baselineScrubTo(pos.group, pos.offset);
    };

    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  // The exact change the scrubber head sits on, recovered through the
  // on-demand scan; feeds the sticker that overlays the group row with the
  // version being looked at. It is suppressed when the head sits exactly on
  // a group's newest change (the row already shows that version).
  const headChange = createMemo<ScanChange | null>(() => {
    const s = props.scrubber();
    if (!s || s.offset === 0) return null;
    const group = groupForScrub(s);
    if (!group || s.head.hash === group.newestHash) return null;
    const rows = resolveGroupChanges(group);
    if (!rows || rows.length === 0) return null;
    return (
      rows.find(
        (r) => r.hash === s.head.hash && r.docUrl === s.head.docUrl
      ) ??
      rows[Math.min(s.offset, rows.length - 1)] ??
      null
    );
  });

  // The sticker's +/- counts. With the eye open they cover the whole diff
  // range — each member diffed from the checkpoint's `from` (the baseline)
  // to its `to` (the head), summed — so extending the baseline grows them.
  // With the eye closed there is no range, so they fall back to the single
  // change under the head.
  const headCounts = createMemo(() => {
    const change = headChange();
    if (!change) return null;
    if (props.eyeOpen()) {
      const at = props.checkpoint();
      const srcs = sources();
      if (at && srcs) {
        let additions = 0;
        let deletions = 0;
        let spans = 0;
        for (const { member, handle } of srcs) {
          const entry = at[member.url];
          if (!entry?.from || !entry.to) continue;
          const doc = handle.doc() as Automerge.Doc<unknown> | undefined;
          if (!doc) continue;
          spans++;
          const counts = computeRangeEditCounts(
            doc,
            decodeHeads(entry.from),
            decodeHeads(entry.to)
          );
          additions += counts.additions;
          deletions += counts.deletions;
        }
        if (spans > 0) return { additions, deletions };
      }
    }
    return computeEditCounts(change.doc, change.hash, change.deps);
  });

  return (
    <div class="draft-card-changes">
      <Show
        when={timeGroups().length > 0}
        fallback={
          <Show
            when={isBuilding()}
            fallback={<div class="draft-changes-empty">No changes yet.</div>}
          >
            <div class="draft-changes-building">
              <span class="draft-building-spinner" />
              Building history…
            </div>
          </Show>
        }
      >
        <div class="draft-changes-body">
          <div
            class="draft-scrubber"
            ref={trackEl}
            title="Click or drag anywhere in the gutter to scrub through history"
            onPointerDown={(ev) => beginDrag(ev, true)}
          />
          <div class="draft-changes-rows" ref={setRowsEl}>
            <For each={timeGroups()}>
              {(group) => (
                <TimeGroupRow
                  group={group}
                  rowRef={(el) => rowEls.set(group.id, el)}
                  onSelect={() => selectGroup(group)}
                />
              )}
            </For>
            {/* Rebuilds backfill oldest history last, so the gap sits below
                the rows that have already painted. */}
            <Show when={isBuilding()}>
              <div class="draft-changes-building">
                <span class="draft-building-spinner" />
                Building history…
              </div>
            </Show>
          </div>
          <Show when={tokenGeometry()}>
            <div
              class="draft-scrubber-token"
              style={{ top: `${tokenGeometry()!.top}px` }}
            >
              {/* The head line, painted on top of the group rows. */}
              <div class="draft-scrubber-line" />
              {/* Grab handle, confined to the gutter. */}
              <div
                class="draft-scrubber-edge"
                title="Drag to scrub through history — drop at the top to return to the latest version"
                onPointerDown={beginDrag}
              />
              <div
                class="draft-scrubber-dot"
                title="Drag to scrub through history — drop at the top to return to the latest version"
                onPointerDown={beginDrag}
              />
              {/* Pinned inside a group: overlay the row with the exact
                  version the head sits on (the card's Fork button forks
                  from it). */}
              <Show when={headChange()}>
                {(change) => (
                  <div
                    class="draft-scrubber-sticker"
                    title="The version being viewed — Fork below to branch from here"
                  >
                    <span class="draft-sticker-time">
                      {formatTime(change().time)}
                    </span>
                    <span class="draft-sticker-spacer" />
                    <EditCounts
                      additions={headCounts()?.additions ?? 0}
                      deletions={headCounts()?.deletions ?? 0}
                    />
                  </div>
                )}
              </Show>
            </div>
          </Show>
          {/* The diff baseline: a second handle (line + hollow circle) shown
              only with the eye open and a version pinned. Independent of the
              head — dragging it re-anchors the diff's older bound — and joined
              to the head by a connector so the two read as one range. */}
          <Show when={baselineGeometry()}>
            <div
              class="draft-scrubber-connector"
              style={{
                top: `${Math.min(tokenGeometry()?.top ?? 0, baselineGeometry()!.top)}px`,
                height: `${Math.abs((tokenGeometry()?.top ?? 0) - baselineGeometry()!.top)}px`,
              }}
            />
            <div
              class="draft-scrubber-token draft-scrubber-token--baseline"
              style={{ top: `${baselineGeometry()!.top}px` }}
            >
              <div class="draft-scrubber-line" />
              <div
                class="draft-scrubber-edge"
                title="Drag to move the diff baseline"
                onPointerDown={beginBaselineDrag}
              />
              <div
                class="draft-scrubber-baseline"
                title="Drag to move the diff baseline"
                onPointerDown={beginBaselineDrag}
              />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// One time group, rendered as a single non-expandable row: author avatars,
// the group's newest timestamp, and the aggregated +/- counts. Clicking the
// row parks the scrubber at the top of the group (the scrubber token is the
// selection indicator — the row itself doesn't highlight).
function TimeGroupRow(props: {
  group: ChangeGroup;
  rowRef: (el: HTMLElement) => void;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      class="draft-group-row"
      ref={props.rowRef}
      title="View the draft as of this group"
      onClick={props.onSelect}
    >
      <AuthorAvatars actors={props.group.actors} />
      <span class="draft-group-time">{formatTime(props.group.endTime)}</span>
      <span class="draft-group-spacer" />
      <EditCounts
        additions={props.group.additions}
        deletions={props.group.deletions}
      />
    </button>
  );
}

// A stack of author avatars, newest-contributor first. Actors with a known
// contact embed the contact tool's own avatar view (image or name initials —
// see contact/src/components/InlineContactAvatar.ts) and are deduped by
// contact — one person editing across several sessions reads as one avatar;
// unattributed actors fall back to actor-id rendering.
function AuthorAvatars(props: { actors: string[] }) {
  const authors = createMemo(() => resolveAuthors(props.actors));
  const visible = () => authors().slice(0, 3);
  const extra = () => Math.max(0, authors().length - 3);
  return (
    <div class="draft-avatars">
      <For each={visible()}>
        {(author, i) => (
          <div
            class="draft-avatar"
            // Attributed avatars carry their own name tooltip (set by the
            // embedded contact view); only the fallback labels the actor id.
            title={author.contactUrl ? undefined : author.key}
            style={{
              background: author.contactUrl
                ? undefined
                : authorColor(author.key),
              "margin-left": i() === 0 ? "0" : "-4px",
              "z-index": String(visible().length - i()),
            }}
          >
            <Show
              when={author.contactUrl}
              fallback={getInitials(author.key)}
            >
              <patchwork-view
                doc-url={author.contactUrl!}
                tool-id="contact-inline"
              />
            </Show>
          </div>
        )}
      </For>
      <Show when={extra() > 0}>
        <div class="draft-avatar draft-avatar--extra">+{extra()}</div>
      </Show>
    </div>
  );
}

// The +N / -N edit-size counts shown at the end of a group row.
function EditCounts(props: { additions: number; deletions: number }) {
  return (
    <span class="draft-counts">
      <Show when={props.additions > 0}>
        <span class="draft-count draft-count--add">+{props.additions}</span>
      </Show>
      <Show when={props.deletions > 0}>
        <span class="draft-count draft-count--del">-{props.deletions}</span>
      </Show>
    </span>
  );
}

// Diff baseline mode for a checkpoint. `"none"` writes no `from` (no diff);
// `{ beforeTime }` anchors each member's `from` at its state just before that
// absolute time — the draggable baseline handle's position — so everything
// from there up to the head reads as the diff. The baseline is independent of
// the head (see `onScrub`/`onBaselineScrub`): the two are resolved separately
// and only clamped so the baseline stays at or older than the head.
type CheckpointBase = "none" | { beforeTime: number };

// Build the checkpoint map for a scrub position. Each member's displayed
// version (`to`) is its heads as of `head`: the doc that owns that change is
// pinned exactly to it, every other member to its latest change at or before
// it (approximate but good enough). The diff baseline (`from`) follows
// `base`: omitted for `"none"`, or the member's heads just before
// `beforeTime` (falling back to the fork point — empty heads on main — when
// no post-fork change precedes it). Members with no change at or before
// `head` are omitted entirely: they didn't exist yet, so they fall through to
// live.
async function computeCheckpoint(
  repo: Repo,
  members: DraftMemberDoc[],
  head: ChangeRef,
  base: CheckpointBase
): Promise<DraftCheckpoint> {
  const checkpoint: DraftCheckpoint = {};
  for (const member of members) {
    try {
      const handle = await repo.find<unknown>(member.cloneUrl ?? member.url);
      const doc = handle.doc();
      if (!doc) continue;
      const since = member.clonedAt ? decodeHeads(member.clonedAt) : [];
      const metas = Automerge.getChangesMetaSince(doc, since);

      // Displayed version: exactly the head change for the doc that owns it,
      // otherwise the member's latest change at or before it.
      let to: UrlHeads;
      if (member.url === head.docUrl) {
        // Pin the head's doc exactly even if it falls outside the metas
        // window (robust against a mismatched fork point).
        to = encodeHeads([head.hash]);
      } else {
        let pinnedIndex = -1;
        let bestTime = -Infinity;
        metas.forEach((m, i) => {
          if (m.time <= head.time && m.time >= bestTime) {
            bestTime = m.time;
            pinnedIndex = i;
          }
        });
        if (pinnedIndex < 0) continue;
        to = encodeHeads([metas[pinnedIndex].hash]);
      }

      if (base === "none") {
        checkpoint[member.url] = { to };
        continue;
      }

      // Diff baseline: the member's newest change strictly before the
      // baseline's time. None post-fork means the baseline sits at or before
      // the start of the member's history in this timeline, so diff against
      // the fork point (empty heads on main — the whole doc reads as added).
      let fromIndex = -1;
      let fromTime = -Infinity;
      metas.forEach((m, i) => {
        if (m.time < base.beforeTime && m.time >= fromTime) {
          fromTime = m.time;
          fromIndex = i;
        }
      });
      const from =
        fromIndex >= 0
          ? encodeHeads([metas[fromIndex].hash])
          : (member.clonedAt ?? encodeHeads([]));
      checkpoint[member.url] = { from, to };
    } catch (err) {
      console.warn(
        "[drafts] failed to compute checkpoint for member:",
        member,
        err
      );
    }
  }
  return checkpoint;
}

// ---- Author attribution ----------------------------------------------------
// Module-level, like the `nowMs` ticker below: attribution (actor id ->
// contact url) is globally true, not per host doc, so one merged store can
// serve every card and survive doc switches. Fed by the sidebar's
// attribution-doc subscription. Rendering (including the name tooltip) is
// delegated to the contact tool (`tool-id="contact-inline"`).

const [actorContacts, setActorContacts] = createSignal<
  Record<string, AutomergeUrl>
>({});

// What an avatar renders for one author. `key` dedupes (and seeds the
// fallback rendering): the contact url when attributed, the actor id
// otherwise.
type AuthorDisplay = {
  key: string;
  contactUrl: AutomergeUrl | null;
};

function resolveAuthors(actors: string[]): AuthorDisplay[] {
  const attribution = actorContacts();
  const out: AuthorDisplay[] = [];
  const seen = new Set<string>();
  for (const actor of actors) {
    const contactUrl = attribution[actor] ?? null;
    const key = contactUrl ?? actor;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, contactUrl });
  }
  return out;
}

// A stable-ish color for an author, so the same person reads the same across
// rows. Actors are Automerge actor ids (per device/session), the best "who"
// signal available in a draft's raw change history.
function authorColor(authorId: string): string {
  let hash = 0;
  for (let i = 0; i < authorId.length; i++) {
    hash = authorId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 45%, 63%)`;
}

// Two short characters to stand in for an author on their avatar.
function getInitials(authorId: string): string {
  return authorId.slice(0, 2).toUpperCase();
}

// Ticks so relative timestamps ("5 minutes ago") stay fresh while the panel
// is open. Module-level: one timer serves every row of every card, and it
// lives as long as the module does.
const [nowMs, setNowMs] = createSignal(Date.now());
setInterval(() => setNowMs(Date.now()), 30_000);

// `numeric: "auto"` gives GitHub's phrasing: "yesterday" and "last week"
// instead of "1 day ago" and "1 week ago".
const RELATIVE_TIME = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

// Format an Automerge change time (Unix SECONDS): relative while recent
// ("now", "5 minutes ago", "5 hours ago", "yesterday"), and from a week on
// an absolute date with time ("Jun 12 12:20"), with the year appended only
// once it differs from the current one ("Jun 12, 2025 12:20").
function formatTime(timeSeconds: number): string {
  if (!timeSeconds) return "";
  const date = new Date(timeSeconds * 1000);
  const seconds = Math.max(0, Math.floor((nowMs() - date.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return "now";
  if (hours < 1) return RELATIVE_TIME.format(-minutes, "minute");
  if (days < 1) return RELATIVE_TIME.format(-hours, "hour");
  if (days < 7) return RELATIVE_TIME.format(-days, "day");
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date(nowMs()).getFullYear()
        ? undefined
        : "numeric",
  });
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${day} ${time}`;
}
