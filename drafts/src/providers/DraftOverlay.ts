import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import {
  accept,
  request,
  subscribe,
  type SubscribeEvent,
} from "@inkandswitch/patchwork-providers";

import type { DraftChanges, DraftDoc, DraftSelection } from "../draft-types.js";
import { canonicalUrl } from "../clone-policy.js";
import { DraftRepo, baseRepo } from "../draft-repo.js";
import { watchDraftChanges } from "../draft-changes.js";

const CHECKOUT_SELECTOR = "checkout";
const SET_CHECKOUT_SELECTOR = "checkout:set";
const CHANGES_SELECTOR = "draft:changes";

// Finds wait this long for the frame's checkout before reading main.
const CHECKOUT_TIMEOUT_MS = 1000;
// Far more parents than any real draft has.
const MAX_DRAFT_DEPTH = 32;

// A draft overlay that only follows: mounted on a draft root (a workspace
// folder in the sidebar), it hands its subtree a `DraftRepo` showing whatever
// the frame's checkout provider has checked out for that root, at its
// checkpoint. Edits made through it land on that draft. Answers:
//   - `draft:changes` → DraftChanges, pushed on every change
//
// The checkout is set by the draft provider of the open document. This
// overlay can be mounted while that one isn't, so it checks on its own that
// the draft still exists: one that's been merged, or unlinked from its
// parent (deleted), is shown as main and the checkout put back to main.
export const DraftOverlay = (
  element: HTMLElement & { repo?: Repo },
  inherited: Repo
) => {
  const repo = baseRepo(inherited);
  const rootUrl = urlAttribute(element, "doc-url");
  const outside = element.parentElement ?? element;

  let disposed = false;
  let selection: DraftSelection = { checkedOut: null, at: null };
  let applySeq = 0;
  const watchedChain = new Set<DocHandle<DraftDoc>>();
  const changesSubscribers = new Set<(changes: DraftChanges) => void>();

  let release!: () => void;
  const ready = new Promise<void>((resolve) => (release = resolve));
  const timeout = setTimeout(() => release(), CHECKOUT_TIMEOUT_MS);
  const draftRepo = new DraftRepo(repo, ready);
  element.repo = draftRepo as unknown as Repo;
  if (rootUrl) draftRepo.setRoot(rootUrl);

  const changes = rootUrl
    ? watchDraftChanges({
        repo,
        view: draftRepo as unknown as Repo,
        root: rootUrl,
        onChange: (next) => {
          for (const respond of changesSubscribers) respond(next);
        },
      })
    : null;

  const unsubscribe = rootUrl
    ? subscribe<DraftSelection>(
        outside,
        { type: CHECKOUT_SELECTOR, root: rootUrl },
        (next) => {
          selection = next;
          void apply();
        }
      )
    : () => {};
  if (!rootUrl) release();

  element.addEventListener("patchwork:subscribe", onSubscribe);

  return () => {
    disposed = true;
    clearTimeout(timeout);
    unsubscribe();
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    unwatchChain();
    changesSubscribers.clear();
    changes?.dispose();
    draftRepo.dispose();
  };

  function onSubscribe(event: SubscribeEvent): void {
    if (event.detail.selector.type !== CHANGES_SELECTOR || !changes) return;
    accept<DraftChanges>(event, (respond) => {
      respond(changes.current());
      changesSubscribers.add(respond);
      return () => {
        changesSubscribers.delete(respond);
      };
    });
  }

  async function apply(): Promise<void> {
    const seq = ++applySeq;
    const { checkedOut, at } = selection;
    const draft = checkedOut
      ? await repo.find<DraftDoc>(checkedOut).catch(() => null)
      : null;
    const live = draft ? await isLive(draft) : true;
    if (disposed || seq !== applySeq) return;
    const shown = draft && live ? { draft, at } : { draft: null, at: draft ? null : at };
    draftRepo.checkout(shown);
    changes?.update(shown);
    clearTimeout(timeout);
    release();
    if (checkedOut && !live) {
      void request(outside, {
        type: SET_CHECKOUT_SELECTOR,
        root: rootUrl,
        checkedOut: null,
        at: null,
      });
    }
  }

  // Not merged, and linked from its parent all the way up to main. Every
  // draft on the way is watched, so a merge or delete elsewhere re-applies.
  async function isLive(draft: DocHandle<DraftDoc>): Promise<boolean> {
    unwatchChain();
    let child = draft;
    for (let depth = 0; depth < MAX_DRAFT_DEPTH; depth++) {
      watch(child);
      const doc = child.doc();
      if (!doc || doc.isMain) return !!doc;
      if (doc.mergedAt !== undefined) return false;
      // Drafts from before `parent` existed hang off main.
      if (!doc.parent || !isValidAutomergeUrl(doc.parent)) return true;
      const parent = await repo.find<DraftDoc>(doc.parent).catch(() => null);
      if (!parent) return false;
      const linked = (parent.doc()?.drafts ?? []).some(
        (url) => canonicalUrl(url) === canonicalUrl(child.url)
      );
      if (!linked) {
        watch(parent);
        return false;
      }
      child = parent;
    }
    return false;
  }

  function watch(handle: DocHandle<DraftDoc>): void {
    if (watchedChain.has(handle)) return;
    watchedChain.add(handle);
    handle.on("change", onChainChange);
  }

  function unwatchChain(): void {
    for (const handle of watchedChain) handle.off("change", onChainChange);
    watchedChain.clear();
  }

  function onChainChange(): void {
    void apply();
  }
};

function urlAttribute(element: HTMLElement, name: string): AutomergeUrl | null {
  const raw = element.getAttribute(name);
  if (raw === null || raw === "") return null;
  if (isValidAutomergeUrl(raw)) return raw;
  console.warn(
    `[drafts] <patchwork-view component="patchwork-draft-overlay"> ` +
      `has an invalid ${name} attribute (got ${JSON.stringify(raw)})`
  );
  return null;
}
