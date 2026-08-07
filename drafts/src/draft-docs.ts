import type {
  DocHandle,
  Repo,
} from "@automerge/automerge-repo/slim";

import type { DraftDoc, HasDrafts } from "./draft-types.js";

// Resolve the host doc's main draft, creating it and stamping
// `@patchwork.mainDraftUrl` the first time.
export async function ensureMainDraft(
  repo: Repo,
  docHandle: DocHandle<HasDrafts>
): Promise<DocHandle<DraftDoc>> {
  const existingUrl = docHandle.doc()?.["@patchwork"]?.mainDraftUrl;
  if (existingUrl) return repo.find<DraftDoc>(existingUrl);

  const mainDraft = repo.create<DraftDoc>({
    "@patchwork": { type: "draft" },
    isMain: true,
    parent: docHandle.url,
    drafts: [],
    clones: {},
  });
  docHandle.change((d) => {
    // Mutate `@patchwork` in place. Reassigning a spread would carry
    // references to existing Automerge objects into a new object.
    if (!d["@patchwork"]) d["@patchwork"] = {};
    d["@patchwork"]!.mainDraftUrl = mainDraft.url;
  });
  return mainDraft;
}
