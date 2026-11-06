import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

import { readHashParam, writeHashParams } from "./hash-params.js";

export type DraftRouterOptions = {
  checkedOut: () => AutomergeUrl | null;
  select: (draftUrl: AutomergeUrl | null) => void;
};

// Keeps the checked-out draft and the `draft=` URL parameter in sync. A
// `draft=` the router doesn't know yet stays pending until it shows up among
// the root's live drafts, and is only then selected. Opening another doc
// drops the parameter from the URL without leaving the draft; the workspace
// provider stamps it back once it knows the doc stayed in this root.
export function createDraftRouter(options: DraftRouterOptions): DraftRouter {
  let availableDrafts = new Set<AutomergeUrl>();
  let pendingUrlDraft: AutomergeUrl | null = readHashParam("draft");
  let lastDoc = readHashParam("doc");
  let disposed = false;

  window.addEventListener("hashchange", onHashChange);

  return {
    updateAvailableDrafts(draftUrls) {
      if (disposed) return;
      availableDrafts = new Set(draftUrls);
      reconcileSelection();
    },
    selectionChanged: syncSelectionToUrl,
    dispose() {
      disposed = true;
      window.removeEventListener("hashchange", onHashChange);
    },
  };

  function onHashChange(): void {
    if (disposed) return;
    const urlDraft = readHashParam("draft");
    const doc = readHashParam("doc");
    const navigated = doc !== lastDoc;
    lastDoc = doc;
    const selected = options.checkedOut();
    if (urlDraft === selected) {
      pendingUrlDraft = null;
      return;
    }
    if (urlDraft === null && navigated) return;
    if (urlDraft === null) {
      pendingUrlDraft = null;
      selectDraft(null);
      return;
    }
    if (availableDrafts.has(urlDraft)) {
      pendingUrlDraft = null;
      selectDraft(urlDraft);
      return;
    }
    pendingUrlDraft = urlDraft;
  }

  function reconcileSelection(): void {
    if (pendingUrlDraft && availableDrafts.has(pendingUrlDraft)) {
      const target = pendingUrlDraft;
      pendingUrlDraft = null;
      selectDraft(target);
      return;
    }
    const selected = options.checkedOut();
    if (selected && !availableDrafts.has(selected)) selectDraft(null);
  }

  function selectDraft(selected: AutomergeUrl | null): void {
    if (options.checkedOut() === selected) return;
    options.select(selected);
  }

  function syncSelectionToUrl(): void {
    if (disposed) return;
    const selected = options.checkedOut();
    if (pendingUrlDraft && selected !== pendingUrlDraft) pendingUrlDraft = null;
    writeHashParams({ draft: selected });
  }
}

export type DraftRouter = {
  updateAvailableDrafts: (draftUrls: readonly AutomergeUrl[]) => void;
  selectionChanged: () => void;
  dispose: () => void;
};
