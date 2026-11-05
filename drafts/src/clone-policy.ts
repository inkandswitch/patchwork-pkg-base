import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";

// Reduce a url to its bare document identity by stripping any path/heads
// suffix, so urls arriving from different traversals dedupe to the same key.
export function canonicalUrl(url: AutomergeUrl): AutomergeUrl {
  const { documentId } = parseAutomergeUrl(url);
  return stringifyAutomergeUrl({ documentId });
}
