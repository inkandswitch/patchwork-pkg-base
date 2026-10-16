import type {
  AutomergeUrl,
  Repo,
  UrlHeads,
} from "@automerge/automerge-repo/slim";

import { canonicalUrl } from "./clone-policy.js";
import { collectDraftMembers } from "./draft-membership.js";
import { isDraftDoc, type CloneEntry } from "./draft-types.js";

// What a fork branches off: for every document, the copy the branch point
// sees — the nearest ancestor draft's clone, or the original on main.
export type Lineage = {
  // The host document the draft tree hangs off (the main draft's `parent`);
  // null when the chain couldn't be resolved.
  hostUrl: AutomergeUrl | null;
  // The document to read and fork `original` from.
  source(original: AutomergeUrl): AutomergeUrl;
  // Where the branch point forked `original` (its clone's `clonedAt`); null
  // when the branch point reads the original.
  forkPoint(original: AutomergeUrl): UrlHeads | null;
};

// The lineage of `draftUrl` as a branch point: its clones, then its parent's,
// and so on up to the main draft (whose `parent` is the host doc). `null` or
// the main draft itself means main.
export async function loadLineage(
  repo: Repo,
  draftUrl: AutomergeUrl | null
): Promise<Lineage> {
  const chain: Record<AutomergeUrl, CloneEntry>[] = [];
  let hostUrl: AutomergeUrl | null = null;
  const seen = new Set<AutomergeUrl>();
  let cursor: AutomergeUrl | undefined | null = draftUrl;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const doc = (await repo.find<unknown>(cursor)).doc();
    if (!isDraftDoc(doc)) {
      // Legacy drafts point straight at the host doc.
      hostUrl = cursor;
      break;
    }
    if (doc.isMain) {
      hostUrl = doc.parent;
      break;
    }
    chain.push(doc.clones);
    cursor = doc.parent;
  }

  const entryFor = (url: AutomergeUrl): CloneEntry | undefined =>
    chain.find((clones) => clones[url])?.[url];
  return {
    hostUrl,
    source(original) {
      const entry = entryFor(original);
      return entry ? canonicalUrl(entry.cloneUrl) : original;
    },
    forkPoint(original) {
      return entryFor(original)?.clonedAt ?? null;
    },
  };
}

// Fork every document reachable from `roots`, as `lineage` sees them, at its
// current heads. Docs already in `existing` are walked through their clone
// and not forked again.
export async function forkReachable(
  repo: Repo,
  roots: readonly AutomergeUrl[],
  lineage: Lineage,
  existing: Record<AutomergeUrl, CloneEntry> = {}
): Promise<Record<AutomergeUrl, CloneEntry>> {
  const members = await collectDraftMembers(roots, async (url) => {
    const backing = existing[url]
      ? canonicalUrl(existing[url].cloneUrl)
      : lineage.source(url);
    return (await repo.find<unknown>(backing)).doc();
  });
  return forkMembers(
    repo,
    members.filter((url) => !existing[url]),
    lineage
  );
}

// Clone each of `urls` from its lineage source at its current heads. A doc
// that fails to fork is left out (and so resolves to the original).
export async function forkMembers(
  repo: Repo,
  urls: readonly AutomergeUrl[],
  lineage: Lineage
): Promise<Record<AutomergeUrl, CloneEntry>> {
  const clones: Record<AutomergeUrl, CloneEntry> = {};
  for (const url of urls) {
    try {
      const source = await repo.find<unknown>(lineage.source(url));
      const clonedAt = source.heads();
      const clone = repo.clone(source);
      clones[url] = { cloneUrl: canonicalUrl(clone.url), clonedAt };
    } catch (err) {
      console.warn(`[drafts] failed to fork ${url}:`, err);
    }
  }
  return clones;
}
