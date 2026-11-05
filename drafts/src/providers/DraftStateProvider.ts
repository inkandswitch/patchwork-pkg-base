import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";

import type {
  Baseline,
  CheckedOutDraft,
  DraftList,
  HasWorkspaceCheckouts,
} from "../draft-types.js";
import { canonicalUrl } from "../clone-policy.js";
import { baseRepo } from "../draft-repo.js";
import { ensureWorkspaceCheckouts } from "../workspace-docs.js";
import { createDraftState } from "./draft-state.js";

const ROOT_DOC_SELECTOR = "draft:root-doc";
const CHECKED_OUT_SELECTOR = "draft:checked-out";
const DRAFT_LIST_SELECTOR = "draft:list";
const BASELINE_SELECTOR = "draft:baseline";

const ATTR_DOC_URL = "doc-url";
const ATTR_CHECKED_OUT = "checked-out";
const ATTR_ACCOUNT_URL = "account-url";

// One ephemeral CheckedOutDraft per host doc for the life of this realm. The
// host remounts this provider on every doc switch; a fresh doc per mount
// would be stored and synced to every peer each time (delete is local-only),
// so the doc is kept and reset on remount instead: to the `checked-out`
// attribute's draft when given, else to main, with the checkpoint cleared.
const checkoutDocs = new Map<AutomergeUrl, DocHandle<CheckedOutDraft>>();

function checkoutFor(
  repo: Repo,
  docUrl: AutomergeUrl,
  seed: AutomergeUrl | null
): DocHandle<CheckedOutDraft> {
  let handle = checkoutDocs.get(docUrl);
  if (!handle) {
    handle = repo.create<CheckedOutDraft>({ checkedOut: seed });
    checkoutDocs.set(docUrl, handle);
    return handle;
  }
  const doc = handle.doc();
  if ((doc?.checkedOut ?? null) !== seed || doc?.at != null) {
    handle.change((d) => {
      d.checkedOut = seed;
      d.at = null;
    });
  }
  return handle;
}

// Mounts on a draft root — a document, or the workspace folder a document
// belongs to (see `WorkspaceProvider`) — and exposes its draft state. Four
// subscriptions:
//   - `draft:root-doc`    → AutomergeUrl of the doc this provider is on
//   - `draft:checked-out` → AutomergeUrl of the ephemeral, writeable
//     CheckedOutDraft doc; holds only the selection (`checkedOut = null` = main)
//   - `draft:list`        → DraftList (see `createDraftState`)
//   - `draft:baseline`    → Baseline for one doc
//
// Consumers recover the live `DocHandle`s from their own repo, so member
// entries carry only plain `AutomergeUrl`s.
export const DraftStateProvider = (element: HTMLElement, inherited: Repo) => {
  const rawUrl = element.getAttribute(ATTR_DOC_URL);
  if (!rawUrl || !isValidAutomergeUrl(rawUrl)) {
    console.warn(
      `[drafts] <patchwork-view component="patchwork-draft-state-provider"> ` +
        `is missing a valid ${ATTR_DOC_URL} attribute (got ${JSON.stringify(rawUrl)})`
    );
    return () => {};
  }
  const docUrl: AutomergeUrl = rawUrl;

  const repo = baseRepo(inherited);

  const rawSeed = element.getAttribute(ATTR_CHECKED_OUT);
  const seed = rawSeed && isValidAutomergeUrl(rawSeed) ? rawSeed : null;
  const checkedOutHandle = checkoutFor(repo, docUrl, seed);
  const stopPersisting = persistCheckouts(
    repo,
    element.getAttribute(ATTR_ACCOUNT_URL),
    docUrl,
    checkedOutHandle
  );
  const state = createDraftState({
    repo,
    docUrl,
    checkedOutHandle,
    element,
  });

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
      accept<DraftList>(event, (respond) => state.subscribeList(respond));
      return;
    }

    if (type === BASELINE_SELECTOR) {
      const rawTarget = (event.detail.selector as { url?: unknown }).url;
      if (typeof rawTarget !== "string" || !isValidAutomergeUrl(rawTarget)) {
        return;
      }
      const target = canonicalUrl(rawTarget);
      accept<Baseline>(event, (respond) =>
        state.subscribeBaseline(target, respond)
      );
      return;
    }
  };

  element.addEventListener("patchwork:subscribe", onSubscribe);

  return () => {
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    stopPersisting();
    state.dispose();
  };
};

// With an `account-url`, mirror which draft is checked out on `docUrl` into
// the account's WorkspaceCheckoutsDoc, so it survives reloads and follows the
// account across devices. Only the selection is persisted; the history
// checkpoint (`at`) stays ephemeral.
function persistCheckouts(
  repo: Repo,
  rawAccountUrl: string | null,
  docUrl: AutomergeUrl,
  checkedOutHandle: DocHandle<CheckedOutDraft>
): () => void {
  if (!rawAccountUrl || !isValidAutomergeUrl(rawAccountUrl)) return () => {};
  const accountUrl: AutomergeUrl = rawAccountUrl;
  let disposed = false;
  let last = checkedOutHandle.doc()?.checkedOut ?? null;

  const onChange = () => {
    const selected = checkedOutHandle.doc()?.checkedOut ?? null;
    if (selected === last) return;
    last = selected;
    void persist(selected).catch((err) => {
      console.warn("[drafts] failed to persist the checked-out draft:", err);
    });
  };
  checkedOutHandle.on("change", onChange);

  return () => {
    disposed = true;
    checkedOutHandle.off("change", onChange);
  };

  async function persist(selected: AutomergeUrl | null): Promise<void> {
    const account = await repo.find<HasWorkspaceCheckouts>(accountUrl);
    if (disposed) return;
    if (!selected && !account.doc()?.workspaceCheckoutsUrl) return;
    const checkouts = await ensureWorkspaceCheckouts(repo, account);
    if (disposed) return;
    if ((checkouts.doc()?.checkedOut?.[docUrl] ?? null) === selected) return;
    checkouts.change((d) => {
      if (!d.checkedOut) d.checkedOut = {};
      if (selected) d.checkedOut[docUrl] = selected;
      else delete d.checkedOut[docUrl];
    });
  }
}
