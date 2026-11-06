import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";

import type { DraftDoc, HasDrafts } from "./draft-types.js";
import { walkDocTree } from "./doc-tree.js";

// Turn a folder into a workspace: from now on its drafts cover every doc
// beneath it. Docs beneath it that were drafted on their own would be hidden
// behind the folder (the topmost workspace wins), so their drafts move onto
// the folder's main draft. Their clones are keyed by original url, which makes
// each one a valid draft of the folder that just hasn't touched the other
// docs yet.
export async function makeWorkspace(
  repo: Repo,
  folder: DocHandle<HasDrafts>,
  mainDraft: DocHandle<DraftDoc>
): Promise<void> {
  folder.change((d) => {
    if (!d["@patchwork"]) d["@patchwork"] = {};
    d["@patchwork"]!.workspace = true;
  });

  for (const url of await descendants(repo, folder.url)) {
    try {
      const handle = await repo.find<HasDrafts>(url);
      const nestedUrl = handle.doc()?.["@patchwork"]?.mainDraftUrl;
      if (!nestedUrl || nestedUrl === mainDraft.url) continue;
      await absorbDrafts(repo, await repo.find<DraftDoc>(nestedUrl), mainDraft);
    } catch (err) {
      console.warn("[drafts] failed to absorb drafts of", url, err);
    }
  }
}

async function absorbDrafts(
  repo: Repo,
  from: DocHandle<DraftDoc>,
  into: DocHandle<DraftDoc>
): Promise<void> {
  const children = (from.doc()?.drafts ?? []).filter(isValidAutomergeUrl);
  for (const childUrl of children) {
    const child = await repo.find<DraftDoc>(childUrl);
    child.change((d) => {
      d.parent = into.url;
    });
    into.change((d) => {
      if (!d.drafts.includes(childUrl)) d.drafts.push(childUrl);
    });
  }
  if (children.length === 0) return;
  from.change((d) => {
    d.drafts.splice(0, d.drafts.length);
  });
}

// Every doc beneath `root`, root excluded.
async function descendants(
  repo: Repo,
  root: AutomergeUrl
): Promise<AutomergeUrl[]> {
  const { urls } = await walkDocTree(repo, root);
  return urls.slice(1);
}
