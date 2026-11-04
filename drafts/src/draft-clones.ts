import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";

import type { DraftDoc } from "./draft-types.js";
import { SKIPPED_DATATYPES, canonicalUrl } from "./clone-policy.js";

// Ensure a clone of `original` exists in `draft` and return its url. Reuses
// the clone recorded in `DraftDoc.clones`; otherwise forks `original` at its
// current heads and records the fork point so the baseline and merge-back can
// find it.
export async function ensureClone(
  repo: Repo,
  draft: DocHandle<DraftDoc>,
  original: AutomergeUrl
): Promise<AutomergeUrl> {
  const existing = draft.doc()?.clones?.[original];
  if (existing) return canonicalUrl(existing.cloneUrl);

  const originalHandle = await repo.find<unknown>(original);
  const recorded = draft.doc()?.clones?.[original];
  if (recorded) return canonicalUrl(recorded.cloneUrl);

  const clonedAt = originalHandle.heads();
  const clone = repo.clone(originalHandle);
  const cloneUrl = canonicalUrl(clone.url);
  draft.change((d) => {
    d.clones[original] = { cloneUrl, clonedAt };
  });
  return cloneUrl;
}

// Stamp `heads` onto `url` (same documentId), or return it unchanged when
// there is no pin. Heads ride on the url so `OverlayRepo` resolves the doc at
// that point in time.
export function withHeads(
  url: AutomergeUrl,
  heads: UrlHeads | undefined
): AutomergeUrl {
  if (!heads) return url;
  return stringifyAutomergeUrl({
    documentId: parseAutomergeUrl(url).documentId,
    heads,
  });
}

// A doc is skipped when its `@patchwork.type` is in `SKIPPED_DATATYPES`. On
// any failure we fall back to cloning, which is the safe default — a doc that
// should be skipped merely keeps forking, it isn't lost.
export async function isSkippedDoc(
  repo: Repo,
  url: AutomergeUrl
): Promise<boolean> {
  const type = await docType(repo, url);
  return type != null && SKIPPED_DATATYPES.has(type);
}

export async function docType(
  repo: Repo,
  url: AutomergeUrl
): Promise<string | undefined> {
  try {
    const handle = await repo.find<{ "@patchwork"?: { type?: unknown } }>(url);
    const type = handle.doc()?.["@patchwork"]?.type;
    return typeof type === "string" ? type : undefined;
  } catch {
    return undefined;
  }
}
