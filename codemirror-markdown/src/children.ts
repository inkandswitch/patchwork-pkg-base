import {
  isValidDocumentId,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocumentId,
} from "@automerge/automerge-repo/slim";

// Same marker the embed extension renders: [patchwork:docId] or
// [patchwork:docId/toolId].
const EMBED_PATTERN = /\[patchwork:([^/\]]+)(?:\/([^\]]+))?\]/g;

// The docs embedded in a markdown doc, in text order.
export function markdownChildren(doc: unknown): { url: AutomergeUrl }[] {
  const content = (doc as { content?: unknown } | undefined)?.content;
  if (typeof content !== "string") return [];
  const out: { url: AutomergeUrl }[] = [];
  for (const [, docId] of content.matchAll(EMBED_PATTERN)) {
    if (!isValidDocumentId(docId)) continue;
    out.push({ url: stringifyAutomergeUrl(docId as DocumentId) });
  }
  return out;
}
