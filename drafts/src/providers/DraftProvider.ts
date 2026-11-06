import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import {
  accept,
  request,
  type SubscribeEvent,
} from "@inkandswitch/patchwork-providers";

import type {
  Baseline,
  DraftCheckpoint,
  DraftDoc,
  DraftList,
  DraftSelection,
  DraftStatus,
} from "../draft-types.js";
import { canonicalUrl } from "../clone-policy.js";
import { DraftRepo, baseRepo } from "../draft-repo.js";
import { readHashParam } from "../hash-params.js";
import { createDraftState, type DraftState } from "./draft-state.js";

const ROOT_DOC_SELECTOR = "draft:root-doc";
const STATUS_SELECTOR = "draft:status";
const SELECTION_SELECTOR = "draft:selection";
const SELECT_SELECTOR = "draft:select";
const DRAFT_LIST_SELECTOR = "draft:list";
const BASELINE_SELECTOR = "draft:baseline";
const WORKSPACE_DRAFT_SELECTOR = "workspace:draft";

// How long a `draft=` from the URL gets to show up among the root's drafts
// before it's reported unavailable. It's still taken if it shows up later.
const VERIFY_TIMEOUT_MS = 5000;

// Mounts on a draft root — a document, or the workspace folder a document
// belongs to (see `WorkspaceProvider`) — and hands everything beneath it a
// `DraftRepo`, so documents resolve onto the checked-out draft and edits stay
// inside it. Answers:
//   - `draft:root-doc`  → the root's AutomergeUrl
//   - `draft:status`    → DraftStatus, pushed on every change
//   - `draft:selection` → DraftSelection, pushed on every change
//   - `draft:select { checkedOut, at }` → sets the selection, answers it
//   - `draft:list`      → DraftList (see `createDraftState`)
//   - `draft:baseline { url }` → Baseline for one doc
//
// The URL is the only record of the checked-out draft: the selection starts
// from `draft=` and the draft router writes it back. Until a `draft=` is
// confirmed as a live draft of this root, documents beneath wait and the
// status is `verifying`; past VERIFY_TIMEOUT_MS it's `unavailable`, until the
// draft shows up or something else is selected.
//
// Without a `doc-url` there is no root: every doc forks and there is no draft
// list. That is how the chat preview iframe (see chat's `preview-frame.ts`)
// pins a self-bootstrapped realm to the draft in its `url` attribute. The
// checked-out draft is reflected onto `draft-url` for outside readers.
export const DraftProvider = (
  element: HTMLElement & { repo?: Repo },
  inherited: Repo
) => {
  const repo = baseRepo(inherited);
  const rootUrl = urlAttribute(element, "doc-url");
  const seed = urlAttribute(element, "url");
  const urlDraft = rootUrl ? readHashParam("draft") : null;

  let disposed = false;
  let selection: DraftSelection = { checkedOut: seed, at: null };
  let status: DraftStatus = urlDraft ? "verifying" : "ready";
  let draft: DocHandle<DraftDoc> | null = null;
  let applySeq = 0;
  const selectionSubscribers = new Set<(selection: DraftSelection) => void>();
  const statusSubscribers = new Set<(status: DraftStatus) => void>();

  let release!: () => void;
  const ready = new Promise<void>((resolve) => (release = resolve));
  const draftRepo = new DraftRepo(inherited, ready);
  element.repo = draftRepo as unknown as Repo;
  if (rootUrl) draftRepo.setRoot(rootUrl);

  const state: DraftState | null = rootUrl
    ? createDraftState({
        repo,
        docUrl: rootUrl,
        selection: () => selection,
        select: (checkedOut) => select({ checkedOut, at: null }),
        element,
      })
    : null;

  const verifyTimer = urlDraft
    ? setTimeout(() => {
        if (status === "verifying") setStatus("unavailable");
      }, VERIFY_TIMEOUT_MS)
    : null;
  if (!urlDraft) void settle();

  const onSubscribe = (event: SubscribeEvent) => {
    const { selector } = event.detail;

    if (selector.type === ROOT_DOC_SELECTOR) {
      if (!rootUrl) return;
      accept<AutomergeUrl>(event, (respond) => {
        respond(rootUrl);
      });
      return;
    }

    if (selector.type === STATUS_SELECTOR) {
      accept<DraftStatus>(event, (respond) => {
        respond(status);
        statusSubscribers.add(respond);
        return () => {
          statusSubscribers.delete(respond);
        };
      });
      return;
    }

    if (selector.type === SELECTION_SELECTOR) {
      accept<DraftSelection>(event, (respond) => {
        selectionSubscribers.add(respond);
        void ready.then(() => {
          if (selectionSubscribers.has(respond)) respond(selection);
        });
        return () => {
          selectionSubscribers.delete(respond);
        };
      });
      return;
    }

    if (selector.type === SELECT_SELECTOR) {
      const next = selectionFrom(selector);
      if (!next) return;
      accept<DraftSelection>(event, (respond) => {
        select(next);
        respond(selection);
      });
      return;
    }

    if (selector.type === DRAFT_LIST_SELECTOR) {
      if (!state) return;
      accept<DraftList>(event, (respond) => state.subscribeList(respond));
      return;
    }

    if (selector.type === BASELINE_SELECTOR) {
      const target = (selector as { url?: unknown }).url;
      if (!state || typeof target !== "string" || !isValidAutomergeUrl(target)) {
        return;
      }
      accept<Baseline>(event, (respond) =>
        state.subscribeBaseline(canonicalUrl(target), respond)
      );
    }
  };
  element.addEventListener("patchwork:subscribe", onSubscribe);

  return () => {
    disposed = true;
    if (verifyTimer !== null) clearTimeout(verifyTimer);
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    selectionSubscribers.clear();
    statusSubscribers.clear();
    state?.dispose();
    draftRepo.dispose();
  };

  // Both the draft router (a deep-linked draft confirmed, or a draft gone)
  // and the user end up here. Any selection settles a pending `draft=`.
  function select(next: DraftSelection): void {
    if (disposed) return;
    const moved = next.checkedOut !== selection.checkedOut;
    selection = next;
    if (status === "ready") void apply();
    else void settle();
    state?.selectionChanged();
    for (const respond of selectionSubscribers) respond(selection);
    if (moved) tellWorkspace();
  }

  // Apply the first confirmed selection, then let documents load.
  async function settle(): Promise<void> {
    if (verifyTimer !== null) clearTimeout(verifyTimer);
    await apply();
    if (disposed) return;
    setStatus("ready");
    tellWorkspace();
    release();
  }

  // Point the draft repo at the selection. Scrubbing keeps the draft, so
  // only a draft switch waits for a find.
  async function apply(): Promise<void> {
    const seq = ++applySeq;
    const { checkedOut, at } = selection;
    element.setAttribute("draft-url", checkedOut ?? "");
    if ((draft?.url ?? null) !== checkedOut) {
      try {
        draft = checkedOut ? await repo.find<DraftDoc>(checkedOut) : null;
      } catch (err) {
        console.error(`[drafts] failed to load draft ${checkedOut}:`, err);
        return;
      }
    }
    if (disposed || seq !== applySeq) return;
    draftRepo.checkout({ draft, at });
  }

  function setStatus(next: DraftStatus): void {
    if (status === next) return;
    status = next;
    for (const respond of statusSubscribers) respond(status);
  }

  // The workspace provider reads its folder tree through the checked-out
  // draft, so docs that only exist on it still count as in the workspace.
  function tellWorkspace(): void {
    if (!rootUrl || status !== "ready") return;
    void request(element, {
      type: WORKSPACE_DRAFT_SELECTOR,
      root: rootUrl,
      draft: selection.checkedOut,
    });
  }
};

function urlAttribute(element: HTMLElement, name: string): AutomergeUrl | null {
  const raw = element.getAttribute(name);
  if (raw === null || raw === "") return null;
  if (isValidAutomergeUrl(raw)) return raw;
  console.warn(
    `[drafts] <patchwork-view component="patchwork-draft-provider"> ` +
      `has an invalid ${name} attribute (got ${JSON.stringify(raw)})`
  );
  return null;
}

function selectionFrom(
  selector: Record<string, unknown>
): DraftSelection | null {
  const { checkedOut, at } = selector;
  if (checkedOut !== null && !isValidAutomergeUrl(checkedOut)) return null;
  if (typeof at !== "object") return null;
  return { checkedOut, at: at as DraftCheckpoint | null };
}
