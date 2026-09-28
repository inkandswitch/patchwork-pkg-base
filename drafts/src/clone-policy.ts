import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";

// Host documents that never get drafts of their own: app-global state and
// the draft machinery's bookkeeping. Opening one shows no drafts and stamps
// no `mainDraftUrl` into it. Which *linked* docs a draft forks is decided by
// the membership walk (see draft-membership.ts), not by this list.
export const UNDRAFTABLE_HOST_TYPES: ReadonlySet<string> = new Set([
  "account",
  "contact",
  "draft",
  "change-group",
  // Legacy marker retained while existing ChangeGroupDocs are migrated.
  "change-group-cache",
  "actor-attribution",
]);

// Reduce a url to its bare document identity by stripping any path/heads
// suffix, so urls arriving from different traversals dedupe to the same key.
export function canonicalUrl(url: AutomergeUrl): AutomergeUrl {
  const { documentId } = parseAutomergeUrl(url);
  return stringifyAutomergeUrl({ documentId });
}
