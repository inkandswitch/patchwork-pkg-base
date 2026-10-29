import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import type { TLShapeId } from "@tldraw/tlschema";

/**
 * A url the tool is opened at, split into the canvas to show and the shape to
 * select. The sidebar opens a shape as its sub-document,
 * `automerge:<id>/store/<shape id>[#heads]` (see path-provider.ts); any other
 * path into a canvas shows the canvas. A url without a path is the canvas.
 */
export function splitShapeUrl(url: AutomergeUrl): {
  docUrl: AutomergeUrl;
  shapeId?: TLShapeId;
} {
  const [base, heads] = url.split("#");
  const match = base.match(/^automerge:([^/]+)\/(.+)$/);
  if (!match) return { docUrl: url };
  const docUrl = `automerge:${match[1]}${heads === undefined ? "" : `#${heads}`}` as AutomergeUrl;
  const segments = match[2].split("/").map(decodeKey);
  const [store, id] = segments;
  return segments.length === 2 && store === "store" && id?.startsWith("shape:")
    ? { docUrl, shapeId: id as TLShapeId }
    : { docUrl };
}

// A key segment as automerge-repo writes one: url-encoded, and `\`-escaped
// when it starts with a character that would read as another kind of segment.
function decodeKey(segment: string): string | undefined {
  try {
    const key = decodeURIComponent(segment);
    return key.startsWith("\\") ? key.slice(1) : key;
  } catch {
    return undefined;
  }
}
