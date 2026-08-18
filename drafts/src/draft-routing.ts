import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo/slim";

import type { CheckedOutDraft } from "./draft-types.js";

// Keeps the ephemeral checkout selection and the `draft=` URL parameter in
// sync. Deep links remain pending until their draft appears in the synced tree.
export function createDraftRouter(
  checkedOutHandle: DocHandle<CheckedOutDraft>
): DraftRouter {
  let availableDrafts = new Set<AutomergeUrl>();
  let pendingUrlDraft: AutomergeUrl | null = readDraftParam();
  let lastCheckedOut: AutomergeUrl | null = null;
  let disposed = false;

  checkedOutHandle.on("change", syncSelectionToUrl);
  window.addEventListener("hashchange", onHashChange);

  return {
    updateAvailableDrafts(draftUrls) {
      if (disposed) return;
      availableDrafts = new Set(draftUrls);
      reconcileSelection();
    },
    dispose() {
      disposed = true;
      checkedOutHandle.off("change", syncSelectionToUrl);
      window.removeEventListener("hashchange", onHashChange);
    },
  };

  function onHashChange(): void {
    if (disposed) return;
    const urlDraft = readDraftParam();
    const selected = checkedOutHandle.doc()?.checkedOut ?? null;
    if (urlDraft === selected) {
      pendingUrlDraft = null;
      return;
    }
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
    const selected = checkedOutHandle.doc()?.checkedOut ?? null;
    if (selected && !availableDrafts.has(selected)) selectDraft(null);
  }

  function selectDraft(selected: AutomergeUrl | null): void {
    if (checkedOutHandle.doc()?.checkedOut === selected) return;
    checkedOutHandle.change((d) => {
      d.checkedOut = selected;
    });
  }

  function syncSelectionToUrl(): void {
    if (disposed) return;
    const selected = checkedOutHandle.doc()?.checkedOut ?? null;
    if (selected === lastCheckedOut) return;
    lastCheckedOut = selected;
    if (pendingUrlDraft && selected !== pendingUrlDraft) pendingUrlDraft = null;
    writeDraftParam(selected);
  }
}

export type DraftRouter = {
  updateAvailableDrafts: (draftUrls: readonly AutomergeUrl[]) => void;
  dispose: () => void;
};

const DRAFT_PARAM = "draft";
const RAW_HASH_KEYS = new Set(["doc", DRAFT_PARAM]);

function readDraftParam(): AutomergeUrl | null {
  const raw = new URLSearchParams(window.location.hash.slice(1)).get(
    DRAFT_PARAM
  );
  return raw && isValidAutomergeUrl(raw) ? raw : null;
}

function writeDraftParam(selected: AutomergeUrl | null): void {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if ((params.get(DRAFT_PARAM) ?? null) === selected) return;
  if (selected) params.set(DRAFT_PARAM, selected);
  else params.delete(DRAFT_PARAM);
  try {
    history.replaceState(null, "", "#" + serializeHash(params));
  } catch {
    // Sandboxed realms can refuse replaceState; the URL is cosmetic there.
  }
}

function serializeHash(params: URLSearchParams): string {
  const parts: string[] = [];
  params.forEach((value, key) => {
    if (!value) return;
    parts.push(
      `${key}=${RAW_HASH_KEYS.has(key) ? value : encodeURIComponent(value)}`
    );
  });
  return parts.join("&");
}
