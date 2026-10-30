// What's selected, as the sidebar compares it. A part of a document
// (`automerge:<id>/<path>`) can come spelled two ways: as automerge-repo writes
// it (`shape%3Aabc`) and as it reads back from the hash, decoded
// (`shape:abc`). Both are one selection.
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

const decode = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** One key for every spelling of a url: path segments decoded, heads kept. */
export function selectionKey(url: string): string {
  const [base, heads] = url.split("#");
  const [doc, ...segments] = base.split("/");
  const key = [doc, ...segments.map(decode)].join("/");
  return heads === undefined ? key : `${key}#${heads}`;
}

/** The document a part of one belongs to (`automerge:<id>`); undefined for a whole one. */
export function containerOfPart(url: string): AutomergeUrl | undefined {
  if (!url.startsWith("automerge:")) return undefined;
  const [doc, ...segments] = url.split("#")[0].split("/");
  return segments.length ? (doc as AutomergeUrl) : undefined;
}
