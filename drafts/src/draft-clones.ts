import type { AutomergeUrl, Repo } from "@automerge/automerge-repo/slim";

import { SKIPPED_DATATYPES } from "./clone-policy.js";

// A doc is skipped when its `@patchwork.type` is in `SKIPPED_DATATYPES`. On
// any failure we fall back to drafting it, which is the safe default — a doc
// that should be skipped merely forks on write, it isn't lost.
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
