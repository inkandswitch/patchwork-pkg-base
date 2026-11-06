import {
  isValidAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";

export type DraftRouterOptions = {
  checkedOut: () => AutomergeUrl | null;
  select: (draftUrl: AutomergeUrl | null) => void;
  // Whether the root's tree has `docUrl`, so opening it stays on the draft.
  covers: (docUrl: AutomergeUrl) => boolean;
};

// Keeps the checked-out draft and the `draft=` URL parameter in sync. Deep
// links remain pending until their draft appears in the synced tree. Opening
// another doc drops the parameter from the URL without leaving the draft.
export function createDraftRouter(options: DraftRouterOptions): DraftRouter {
  let availableDrafts = new Set<AutomergeUrl>();
  let pendingUrlDraft: AutomergeUrl | null = readDraftParam();
  let lastCheckedOut: AutomergeUrl | null = null;
  let lastDoc = readDocParam();
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
    const urlDraft = readDraftParam();
    const doc = readDocParam();
    const navigated = doc !== lastDoc;
    lastDoc = doc;
    const selected = options.checkedOut();
    if (urlDraft === selected) {
      pendingUrlDraft = null;
      return;
    }
    if (urlDraft === null && navigated) {
      if (doc && options.covers(doc)) writeDraftParam(selected);
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
    if (selected === lastCheckedOut) return;
    lastCheckedOut = selected;
    if (pendingUrlDraft && selected !== pendingUrlDraft) pendingUrlDraft = null;
    writeDraftParam(selected);
  }
}

export type DraftRouter = {
  updateAvailableDrafts: (draftUrls: readonly AutomergeUrl[]) => void;
  selectionChanged: () => void;
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

// The hash carries the doc as a bare document id.
function readDocParam(): AutomergeUrl | null {
  const raw = new URLSearchParams(window.location.hash.slice(1)).get("doc");
  if (!raw) return null;
  const url = raw.startsWith("automerge:") ? raw : `automerge:${raw}`;
  return isValidAutomergeUrl(url) ? url : null;
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
