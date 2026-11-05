import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import { subscribe } from "@inkandswitch/patchwork-providers";

import type {
  CheckedOutDraft,
  DraftCheckpoint,
  DraftDoc,
} from "../draft-types.js";
import { DraftRepo } from "../draft-repo.js";

const CHECKED_OUT_SELECTOR = "draft:checked-out";
const ROOT_DOC_SELECTOR = "draft:root-doc";

// Hands everything beneath it a `DraftRepo`, so documents resolve onto the
// checked-out draft (see `DraftRepo` for what that means per doc) and edits
// stay inside it. The repo re-points live handles in place, so a draft switch
// or a checkpoint move remounts nothing.
//
// The selection comes from the ancestor draft-state provider's
// `draft:checked-out` doc: `checkedOut` is the draft (null for main) and `at`
// the checkpoint, whose per-doc `to` heads pin each doc. Its `draft:root-doc`
// is the doc whose tree the draft covers; only docs in it fork on write.
//
// A `url` attribute, when present, seeds the selection. That is how the chat
// preview iframe (see chat's `preview-frame.ts`) pins a self-bootstrapped
// overlay to one draft in a realm with no draft-state provider to follow. The
// current selection is reflected onto the (un-observed, so remount-free)
// `draft-url` attribute for outside readers.
export const DraftOverlayProvider = (
  element: HTMLElement & { repo?: Repo },
  repo: Repo
) => {
  const draftRepo = new DraftRepo(repo);
  element.repo = draftRepo as unknown as Repo;

  let disposed = false;
  let seq = 0;

  const seed = element.getAttribute("url");
  if (seed) {
    if (isValidAutomergeUrl(seed)) {
      void show(seed, null);
    } else {
      console.warn(
        `[drafts] <patchwork-view component="patchwork-draft-overlay-provider"> ` +
          `has an invalid url attribute (got ${JSON.stringify(seed)})`
      );
    }
  }

  const unsubscribeRoot = subscribe<AutomergeUrl>(
    element,
    { type: ROOT_DOC_SELECTOR },
    (url) => {
      if (!disposed && isValidAutomergeUrl(url)) draftRepo.setRoot(url);
    }
  );

  let checkedOutHandle: DocHandle<CheckedOutDraft> | null = null;
  const onCheckedOutChange = () => {
    const doc = checkedOutHandle?.doc();
    void show(doc?.checkedOut ?? null, doc?.at ?? null);
  };
  const unsubscribeCheckedOut = subscribe<AutomergeUrl>(
    element,
    { type: CHECKED_OUT_SELECTOR },
    (url) => {
      if (disposed || !isValidAutomergeUrl(url)) return;
      void repo.find<CheckedOutDraft>(url).then((handle) => {
        if (disposed || checkedOutHandle === handle) return;
        checkedOutHandle?.off("change", onCheckedOutChange);
        checkedOutHandle = handle;
        handle.on("change", onCheckedOutChange);
        onCheckedOutChange();
      });
    }
  );

  return () => {
    disposed = true;
    unsubscribeRoot();
    unsubscribeCheckedOut();
    checkedOutHandle?.off("change", onCheckedOutChange);
    checkedOutHandle = null;
    draftRepo.dispose();
  };

  async function show(
    draftUrl: AutomergeUrl | null,
    at: DraftCheckpoint | null
  ): Promise<void> {
    const mine = ++seq;
    element.setAttribute("draft-url", draftUrl ?? "");
    let draft: DocHandle<DraftDoc> | null = null;
    if (draftUrl) {
      try {
        draft = await repo.find<DraftDoc>(draftUrl);
      } catch (err) {
        console.error(`[drafts] failed to load draft ${draftUrl}:`, err);
        return;
      }
    }
    if (disposed || mine !== seq) return;
    draftRepo.checkout({ draft, at });
  }
};
