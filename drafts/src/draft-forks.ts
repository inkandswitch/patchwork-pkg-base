import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";

import type {
  CloneEntry,
  DraftCheckpoint,
  DraftDoc,
  DraftMemberDoc,
} from "./draft-types.js";
import { computeCheckpoint, type ChangeRef } from "./checkpoint.js";
import { canonicalUrl } from "./clone-policy.js";
import { cloneAt } from "./draft-clones.js";
import { walkDocTree } from "./doc-tree.js";

// The fork points for a draft forked off `parentUrl` (null = main) as of
// `head` (null = now), per doc. A doc the parent cloned branches off its
// clone; one the parent only recorded a fork point for keeps that point,
// since the parent never changed it; every other doc of main's branches off
// the original. Main's docs are the tree under `rootUrl`. A doc that didn't
// exist yet at `head` is left out.
export async function forkPoints(
  repo: Repo,
  rootUrl: AutomergeUrl,
  parentUrl: AutomergeUrl | null,
  head: ChangeRef | null
): Promise<Record<AutomergeUrl, CloneEntry>> {
  const [{ urls: mainUrls }, parentClones] = await Promise.all([
    walkDocTree(repo, canonicalUrl(rootUrl)),
    parentUrl
      ? repo.find<DraftDoc>(parentUrl).then((h) => h.doc()?.clones ?? {})
      : ({} as Record<AutomergeUrl, CloneEntry>),
  ]);
  const clones: Record<AutomergeUrl, CloneEntry> = {};
  const sources: DraftMemberDoc[] = mainUrls
    .filter((url) => !parentClones[url])
    .map((url) => ({ url, cloneUrl: null, clonedAt: null }));
  for (const [url, entry] of Object.entries(parentClones) as [
    AutomergeUrl,
    CloneEntry,
  ][]) {
    if (!entry.cloneUrl) clones[url] = forkEntry(url, entry.source, entry.clonedAt);
    else sources.push({ url, cloneUrl: entry.cloneUrl, clonedAt: entry.clonedAt });
  }

  const versions = head
    ? await computeCheckpoint(repo, sources, head, "none")
    : await currentVersions(repo, sources);
  for (const member of sources) {
    const to = versions[member.url]?.to;
    if (to) {
      clones[member.url] = forkEntry(member.url, member.cloneUrl, to);
    } else if (member.cloneUrl) {
      const entry = parentClones[member.url];
      clones[member.url] = forkEntry(member.url, entry.source, entry.clonedAt);
    }
  }
  return clones;
}

async function currentVersions(
  repo: Repo,
  members: DraftMemberDoc[]
): Promise<DraftCheckpoint> {
  const versions: DraftCheckpoint = {};
  await Promise.all(
    members.map(async (member) => {
      try {
        const handle = await repo.find<unknown>(member.cloneUrl ?? member.url);
        versions[member.url] = { to: handle.heads() };
      } catch (err) {
        console.warn("[drafts] failed to fork member:", member, err);
      }
    })
  );
  return versions;
}

// Automerge rejects `undefined` values, so `source` is only set when the
// draft forks off something other than the doc itself.
function forkEntry(
  url: AutomergeUrl,
  source: AutomergeUrl | null | undefined,
  clonedAt: UrlHeads
): CloneEntry {
  const from = source ? canonicalUrl(source) : null;
  return from && from !== url ? { source: from, clonedAt } : { clonedAt };
}

// Merges every cloned doc back into the parent draft's copy of it — the
// parent's clone, or the original when the parent never forked the doc —
// recording per-clone merge heads for auditing, and marks the draft as merged
// (which hides it from the list). A parent that only recorded a fork point
// for the doc is cloned there first, so the merge lands in the parent rather
// than the original. The merged draft's children are handed up to the merge
// target, so they never dangle under a hidden draft.
export async function mergeDraft(
  repo: Repo,
  draftHandle: DocHandle<DraftDoc>
): Promise<void> {
  const doc = draftHandle.doc();
  const parentHandle = await findMergeTarget(repo, doc?.parent);
  const entries = Object.entries(doc?.clones ?? {}) as [
    AutomergeUrl,
    CloneEntry,
  ][];
  for (const [originalUrl, entry] of entries) {
    if (!entry.cloneUrl) continue;
    const targetUrl = await mergeTargetUrl(repo, parentHandle, originalUrl);
    if (entry.cloneUrl === targetUrl) continue;
    const [target, clone] = await Promise.all([
      repo.find<unknown>(targetUrl),
      repo.find<unknown>(entry.cloneUrl),
    ]);
    target.merge(clone);
    const mergedAt = target.heads();
    draftHandle.change((d) => {
      const e = d.clones[originalUrl];
      if (e) e.mergedAt = mergedAt;
    });
  }
  draftHandle.change((d) => {
    d.mergedAt = Date.now();
  });

  // Re-parent the merged draft's children onto the merge target: they list
  // under it and their own merges land there (where this draft's changes
  // now live). Their clones branched off this draft's clones, whose history
  // was just merged into the target, so they still merge back cleanly.
  if (parentHandle) {
    const children = (draftHandle.doc()?.drafts ?? []).filter(
      isValidAutomergeUrl
    );
    for (const childUrl of children) {
      try {
        const child = await repo.find<DraftDoc>(childUrl);
        child.change((d) => {
          d.parent = parentHandle.url;
        });
        parentHandle.change((d) => {
          if (!d.drafts.includes(childUrl)) d.drafts.push(childUrl);
        });
        draftHandle.change((d) => {
          const i = d.drafts.indexOf(childUrl);
          if (i >= 0) d.drafts.splice(i, 1);
        });
      } catch (err) {
        console.warn(
          "[drafts] failed to re-parent child draft after merge:",
          childUrl,
          err
        );
      }
    }
  }
}

// The parent's copy of `url`, cloning it at the parent's fork point when the
// parent hasn't written to it yet.
async function mergeTargetUrl(
  repo: Repo,
  parentHandle: DocHandle<DraftDoc> | null,
  url: AutomergeUrl
): Promise<AutomergeUrl> {
  const parentEntry = parentHandle?.doc()?.clones?.[url];
  if (!parentHandle || !parentEntry) return url;
  if (parentEntry.cloneUrl) return parentEntry.cloneUrl;
  const source = await repo.find<unknown>(parentEntry.source ?? url);
  const clone = cloneAt(repo, source, parentEntry.clonedAt);
  const cloneUrl = canonicalUrl(clone.url);
  parentHandle.change((d) => {
    const e = d.clones[url];
    if (e && !e.cloneUrl) e.cloneUrl = cloneUrl;
  });
  return parentHandle.doc()?.clones?.[url]?.cloneUrl ?? cloneUrl;
}

// Resolve the draft the merge should land in: the nearest non-merged
// ancestor. A parent that was itself merged away hands its role up the
// chain (its changes live in *its* merge target), ending at the main draft,
// which is never merged. Null when the chain can't be resolved — the caller
// then falls back to merging into the originals.
async function findMergeTarget(
  repo: Repo,
  parentUrl: AutomergeUrl | undefined
): Promise<DocHandle<DraftDoc> | null> {
  const seen = new Set<AutomergeUrl>();
  let cursor = parentUrl;
  while (cursor && isValidAutomergeUrl(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    try {
      const candidate = await repo.find<DraftDoc>(cursor);
      if (candidate.doc()?.mergedAt === undefined) return candidate;
      cursor = candidate.doc()?.parent;
    } catch (err) {
      console.warn(
        "[drafts] failed to load ancestor draft for merge; " +
          "falling back to merging into the originals:",
        cursor,
        err
      );
      return null;
    }
  }
  return null;
}
