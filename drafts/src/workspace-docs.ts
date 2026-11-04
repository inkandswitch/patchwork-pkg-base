import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";

import type {
  DraftDoc,
  HasDrafts,
  HasWorkspaceCheckouts,
  WorkspaceCheckoutsDoc,
} from "./draft-types.js";
import { containerChildren } from "./folder-links.js";

// Resolve the account's WorkspaceCheckoutsDoc, creating it and linking it via
// `workspaceCheckoutsUrl` the first time.
export async function ensureWorkspaceCheckouts(
  repo: Repo,
  account: DocHandle<HasWorkspaceCheckouts>
): Promise<DocHandle<WorkspaceCheckoutsDoc>> {
  const existing = account.doc()?.workspaceCheckoutsUrl;
  if (existing && isValidAutomergeUrl(existing)) {
    return repo.find<WorkspaceCheckoutsDoc>(existing);
  }
  const created = repo.create<WorkspaceCheckoutsDoc>({
    "@patchwork": { type: "workspace-checkouts" },
    checkedOut: {},
  });
  account.change((d) => {
    if (!d.workspaceCheckoutsUrl) d.workspaceCheckoutsUrl = created.url;
  });
  const linked = account.doc()?.workspaceCheckoutsUrl;
  return linked && linked !== created.url
    ? repo.find<WorkspaceCheckoutsDoc>(linked)
    : created;
}

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

// Every doc reachable beneath `root` through containers, root excluded.
async function descendants(
  repo: Repo,
  root: AutomergeUrl
): Promise<AutomergeUrl[]> {
  const seen = new Set<AutomergeUrl>([root]);
  const out: AutomergeUrl[] = [];
  let frontier: AutomergeUrl[] = [root];
  while (frontier.length) {
    const handles = await Promise.all(
      frontier.map((url) => repo.find<unknown>(url).catch(() => null))
    );
    const next: AutomergeUrl[] = [];
    for (const handle of handles) {
      for (const child of containerChildren(handle?.doc())) {
        if (seen.has(child.url)) continue;
        seen.add(child.url);
        out.push(child.url);
        if (child.isContainer) next.push(child.url);
      }
    }
    frontier = next;
  }
  return out;
}
