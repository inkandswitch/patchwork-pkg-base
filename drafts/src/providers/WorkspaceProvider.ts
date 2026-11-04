import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import {
  accept,
  subscribe,
  type SubscribeEvent,
} from "@inkandswitch/patchwork-providers";

import type {
  DraftDoc,
  HasWorkspaceCheckouts,
  WorkspaceCheckoutsDoc,
} from "../draft-types.js";
import { canonicalUrl } from "../clone-policy.js";
import { createWorkspaceIndex } from "../workspace-index.js";

const WORKSPACE_ROOT_SELECTOR = "workspace:root";
const SELECTED_VIEW_SELECTOR = "patchwork:selected-view";

const ATTR_ACCOUNT_URL = "account-url";

// How long the first answer waits for the account and the first walk of its
// folder tree. Past it, the selected doc is answered as its own root and
// re-answered once the walk lands.
const STARTUP_WAIT_MS = 1500;

// The workspace the selected doc belongs to.
//   - `docUrl`: the selected doc, exactly as `patchwork:selected-view` gave
//     it, so the frame can tell which selection an answer is for.
//   - `rootUrl`: the topmost workspace folder on the doc's first path through
//     the account's folder tree, or the doc itself when it isn't in one.
//   - `draftUrl`: the draft the account has checked out on that root, or
//     null for main (a draft merged since reads as main).
export type WorkspaceRoot = {
  docUrl: string;
  rootUrl: AutomergeUrl;
  draftUrl: AutomergeUrl | null;
};

// Answers `workspace:root` for the frame's selected doc, re-answering when
// the selection, the folder tree or the account's checkouts change. Read-only:
// it never creates or edits a document. The frame mounts the per-root
// draft-state and overlay providers from the answer, and the draft-state
// provider persists the checkout.
export const WorkspaceProvider = (element: HTMLElement) => {
  const rawAccountUrl = element.getAttribute(ATTR_ACCOUNT_URL);
  if (!rawAccountUrl || !isValidAutomergeUrl(rawAccountUrl)) {
    console.warn(
      `[drafts] <patchwork-view component="patchwork-workspace-provider"> ` +
        `is missing a valid ${ATTR_ACCOUNT_URL} attribute (got ${JSON.stringify(rawAccountUrl)})`
    );
    return () => {};
  }
  const accountUrl: AutomergeUrl = rawAccountUrl;

  const maybeRepo = "repo" in window ? window.repo : undefined;
  if (!maybeRepo) {
    console.warn("[drafts] window.repo is not set; workspace provider disabled");
    return () => {};
  }
  const repo: Repo = maybeRepo;

  let disposed = false;
  let accountHandle: DocHandle<HasWorkspaceCheckouts> | null = null;
  let checkoutsHandle: DocHandle<WorkspaceCheckoutsDoc> | null = null;
  let selectedUrl: string | null = null;
  let started = false;
  let latest: WorkspaceRoot | null = null;
  let answerSeq = 0;
  const subscribers = new Set<(root: WorkspaceRoot) => void>();

  const index = createWorkspaceIndex(repo, {
    rootFolderUrl: () => accountHandle?.doc()?.rootFolderUrl,
    readUrlFor,
    onChange: () => void update(),
  });

  const onAccountChange = () => {
    index.refresh();
    void followCheckouts();
  };
  const onCheckoutsChange = () => {
    index.refresh();
    void update();
  };

  const ready = (async () => {
    const account = await repo.find<HasWorkspaceCheckouts>(accountUrl);
    if (disposed) return;
    accountHandle = account;
    account.on("change", onAccountChange);
    await followCheckouts();
  })();
  const firstWalk = ready.then(() => {
    index.refresh();
    return index.settled();
  });
  firstWalk.catch((err) => {
    console.error("[drafts] failed to initialize workspace provider:", err);
  });
  void within(firstWalk, STARTUP_WAIT_MS).then(() => {
    started = true;
    void update();
  });

  const unsubscribeSelectedView = subscribe<{ url?: string } | null>(
    element,
    { type: SELECTED_VIEW_SELECTOR },
    (view) => {
      const url = view?.url;
      selectedUrl = typeof url === "string" && isValidAutomergeUrl(url) ? url : null;
      void update();
    }
  );

  const onSubscribe = (event: SubscribeEvent) => {
    if (event.detail.selector.type !== WORKSPACE_ROOT_SELECTOR) return;
    accept<WorkspaceRoot>(event, (respond) => {
      subscribers.add(respond);
      if (latest) respond(latest);
      return () => {
        subscribers.delete(respond);
      };
    });
  };
  element.addEventListener("patchwork:subscribe", onSubscribe);

  return () => {
    disposed = true;
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    unsubscribeSelectedView();
    accountHandle?.off("change", onAccountChange);
    checkoutsHandle?.off("change", onCheckoutsChange);
    index.dispose();
    subscribers.clear();
  };

  // Recompute the selected doc's answer and push it if anything moved.
  async function update(): Promise<void> {
    if (disposed || !started || !selectedUrl) return;
    const seq = ++answerSeq;
    const docUrl = selectedUrl;
    const doc = canonicalUrl(docUrl as AutomergeUrl);
    const rootUrl = index.rootOf(doc) ?? doc;
    const draftUrl = await liveDraft(rootUrl);
    if (disposed || seq !== answerSeq) return;
    if (
      latest?.docUrl === docUrl &&
      latest.rootUrl === rootUrl &&
      latest.draftUrl === draftUrl
    ) {
      return;
    }
    latest = { docUrl, rootUrl, draftUrl };
    for (const respond of subscribers) respond(latest);
  }

  // Start watching the account's checkouts doc once it's linked. Nothing is
  // created here; until the draft-state provider first persists a checkout
  // there's nothing to read.
  async function followCheckouts(): Promise<void> {
    const url = accountHandle?.doc()?.workspaceCheckoutsUrl;
    if (!url || !isValidAutomergeUrl(url) || url === checkoutsHandle?.url) {
      return;
    }
    const handle = await repo.find<WorkspaceCheckoutsDoc>(url);
    if (disposed || handle === checkoutsHandle) return;
    checkoutsHandle?.off("change", onCheckoutsChange);
    checkoutsHandle = handle;
    handle.on("change", onCheckoutsChange);
    onCheckoutsChange();
  }

  async function liveDraft(root: AutomergeUrl): Promise<AutomergeUrl | null> {
    const draftUrl = checkoutsHandle?.doc()?.checkedOut?.[root];
    if (!draftUrl || !isValidAutomergeUrl(draftUrl)) return null;
    try {
      const draft = await repo.find<DraftDoc>(draftUrl);
      return draft.doc()?.mergedAt === undefined ? draftUrl : null;
    } catch {
      return null;
    }
  }

  // Inside a workspace the folder tree is read through the checked-out
  // draft's clones, so folders reorganized on a draft index as they look
  // there.
  async function readUrlFor(
    root: AutomergeUrl,
    url: AutomergeUrl
  ): Promise<AutomergeUrl> {
    const draftUrl = await liveDraft(root);
    if (!draftUrl) return url;
    const draft = await repo.find<DraftDoc>(draftUrl);
    const clone = draft.doc()?.clones?.[url];
    return clone ? canonicalUrl(clone.cloneUrl) : url;
  }
};

// Settles when `promise` does or after `ms`, whichever comes first; never
// rejects.
function within(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      }
    );
  });
}
