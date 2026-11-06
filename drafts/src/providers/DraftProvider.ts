import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";

import type {
  Baseline,
  DraftCheckpoint,
  DraftDoc,
  DraftList,
  DraftSelection,
  HasWorkspaceCheckouts,
  WorkspaceCheckoutsDoc,
} from "../draft-types.js";
import { canonicalUrl } from "../clone-policy.js";
import { DraftRepo, baseRepo } from "../draft-repo.js";
import { ensureWorkspaceCheckouts, liveCheckout } from "../workspace-docs.js";
import { createDraftState, type DraftState } from "./draft-state.js";

const ROOT_DOC_SELECTOR = "draft:root-doc";
const SELECTION_SELECTOR = "draft:selection";
const SELECT_SELECTOR = "draft:select";
const DRAFT_LIST_SELECTOR = "draft:list";
const BASELINE_SELECTOR = "draft:baseline";

// How long documents wait for the account's remembered checkout before
// opening on main.
const CHECKOUT_WAIT_MS = 1500;

// Mounts on a draft root — a document, or the workspace folder a document
// belongs to (see `WorkspaceProvider`) — and hands everything beneath it a
// `DraftRepo`, so documents resolve onto the checked-out draft and edits stay
// inside it. Answers:
//   - `draft:root-doc`  → the root's AutomergeUrl
//   - `draft:selection` → DraftSelection, pushed on every change
//   - `draft:select { checkedOut, at }` → sets the selection, answers it
//   - `draft:list`      → DraftList (see `createDraftState`)
//   - `draft:baseline { url }` → Baseline for one doc
//
// The selection lives here, in memory. With an `account-url`, the checked-out
// draft is read from and written to the account's WorkspaceCheckoutsDoc;
// nothing is written while main stays checked out.
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
  const accountUrl = urlAttribute(element, "account-url");
  const seed = urlAttribute(element, "url");

  let disposed = false;
  let selection: DraftSelection = { checkedOut: seed, at: null };
  let chosen = false;
  let draft: DocHandle<DraftDoc> | null = null;
  let applySeq = 0;
  const subscribers = new Set<(selection: DraftSelection) => void>();

  const ready = restoreCheckout();
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

  const onSubscribe = (event: SubscribeEvent) => {
    const { selector } = event.detail;

    if (selector.type === ROOT_DOC_SELECTOR) {
      if (!rootUrl) return;
      accept<AutomergeUrl>(event, (respond) => {
        respond(rootUrl);
      });
      return;
    }

    if (selector.type === SELECTION_SELECTOR) {
      accept<DraftSelection>(event, (respond) => {
        subscribers.add(respond);
        void ready.then(() => {
          if (subscribers.has(respond)) respond(selection);
        });
        return () => {
          subscribers.delete(respond);
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
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    subscribers.clear();
    state?.dispose();
    draftRepo.dispose();
  };

  function select(next: DraftSelection): void {
    if (disposed) return;
    chosen = true;
    const moved = next.checkedOut !== selection.checkedOut;
    selection = next;
    void apply();
    state?.selectionChanged();
    for (const respond of subscribers) respond(selection);
    if (moved) {
      void persistCheckout(next.checkedOut).catch((err) => {
        console.warn("[drafts] failed to persist the checked-out draft:", err);
      });
    }
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

  // Start on the draft the account last had checked out here, unless
  // something was selected in the meantime. Settles within CHECKOUT_WAIT_MS.
  async function restoreCheckout(): Promise<void> {
    if (rootUrl && accountUrl && !seed) {
      const remembered = await within(
        rememberedCheckout(accountUrl, rootUrl),
        CHECKOUT_WAIT_MS
      );
      if (disposed) return;
      if (remembered && !chosen) {
        selection = { checkedOut: remembered, at: null };
        state?.refresh();
      }
    }
    await apply();
  }

  async function rememberedCheckout(
    account: AutomergeUrl,
    root: AutomergeUrl
  ): Promise<AutomergeUrl | null> {
    const accountHandle = await repo.find<HasWorkspaceCheckouts>(account);
    const url = accountHandle.doc()?.workspaceCheckoutsUrl;
    if (!url || !isValidAutomergeUrl(url)) return null;
    const checkouts = await repo.find<WorkspaceCheckoutsDoc>(url);
    return liveCheckout(repo, checkouts, root);
  }

  // Remember the checked-out draft in the account's WorkspaceCheckoutsDoc.
  // Main is the absence of an entry, so going back to main on an account
  // that never checked out a draft writes nothing.
  async function persistCheckout(
    checkedOut: AutomergeUrl | null
  ): Promise<void> {
    if (!rootUrl || !accountUrl) return;
    const root = rootUrl;
    const account = await repo.find<HasWorkspaceCheckouts>(accountUrl);
    if (disposed) return;
    if (!checkedOut && !account.doc()?.workspaceCheckoutsUrl) return;
    const checkouts = await ensureWorkspaceCheckouts(repo, account);
    if (disposed) return;
    if ((checkouts.doc()?.checkedOut?.[root] ?? null) === checkedOut) return;
    checkouts.change((d) => {
      if (!d.checkedOut) d.checkedOut = {};
      if (checkedOut) d.checkedOut[root] = checkedOut;
      else delete d.checkedOut[root];
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

// Resolves with `promise`'s value, or null after `ms`; never rejects.
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}
