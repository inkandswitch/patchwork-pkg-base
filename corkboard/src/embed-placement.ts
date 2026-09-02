// Pure helpers for dropping a `patchwork-doc` embed into a tldraw5 store from
// outside tldraw — no editor, no React, just the record map the chat computer
// edits with automerge_op. Kept separate from the skill so the arithmetic is
// testable.

export const DEFAULT_EMBED_W = 640;
export const DEFAULT_EMBED_H = 480;
/** Gap left between the existing drawing and an auto-placed embed. */
export const EMBED_GUTTER = 80;

/** Fallback footprint for a shape that carries no explicit w/h (notes, text),
 * used only to keep auto-placement clear of it. */
const ASSUMED_W = 200;
const ASSUMED_H = 200;

type Store = Record<string, any>;

/** Deterministic shape id for a document url. Mirrors tldraw5's
 * `makeShapeId` (PatchworkDocShape.tsx) — copied rather than imported, since
 * every folder here is a standalone package — so an embed we write converges
 * with one the user creates by dragging the same document in. */
export function shapeIdForUrl(docUrl: string): string {
  return "shape:" + docUrl.replace(/[^a-zA-Z0-9]/g, "_");
}

function shapeRecords(store: Store): any[] {
  return Object.values(store || {}).filter(
    (r: any) =>
      r &&
      r.typeName === "shape" &&
      // Only top-level shapes: a child's x/y are relative to its frame, and the
      // frame itself already covers that area.
      (r.parentId === undefined || String(r.parentId).startsWith("page:"))
  );
}

/** Bounding box of the canvas's top-level shapes, or null when it's empty. */
export function contentBounds(
  store: Store
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapeRecords(store)) {
    const x = Number(shape.x);
    const y = Number(shape.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const w = Number(shape.props?.w);
    const h = Number(shape.props?.h);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + (Number.isFinite(w) ? w : ASSUMED_W));
    maxY = Math.max(maxY, y + (Number.isFinite(h) ? h : ASSUMED_H));
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

/** Where to put an embed nobody gave coordinates for: to the right of whatever
 * is already drawn, top-aligned with it — so it lands next to the user's work
 * rather than on top of it or somewhere they have to hunt for. */
export function placeClearOfContent(store: Store): { x: number; y: number } {
  const bounds = contentBounds(store);
  if (!bounds) return { x: 0, y: 0 };
  return { x: bounds.maxX + EMBED_GUTTER, y: bounds.minY };
}

// tldraw's fractional-index alphabet, ascending. Plain string comparison
// matches this order (ASCII puts 0-9 < A-Z < a-z), so the largest index in use
// is just the lexicographic max.
const INDEX_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** An index key that sorts above every shape already on the canvas, so a new
 * embed lands on top. Bumping the last character keeps keys short; when it is
 * already the highest character, appending is the only way up. */
export function indexAbove(store: Store): string {
  let max = "";
  for (const shape of shapeRecords(store)) {
    const index = shape.index;
    if (typeof index === "string" && index > max) max = index;
  }
  if (max === "") return "a1";
  const last = max[max.length - 1];
  const next = INDEX_ALPHABET.indexOf(last) + 1;
  if (next > 0 && next < INDEX_ALPHABET.length) {
    return max.slice(0, -1) + INDEX_ALPHABET[next];
  }
  return max + "1";
}

/** A complete `patchwork-doc` shape record. Complete matters: records go into
 * tldraw's validating store one at a time, and a partial one is rejected. */
export function buildEmbedRecord(opts: {
  shapeId: string;
  index: string;
  x: number;
  y: number;
  w: number;
  h: number;
  docUrl: string;
  docName: string;
  docType: string;
  toolId?: string;
}): Record<string, any> {
  return {
    id: opts.shapeId,
    typeName: "shape",
    type: "patchwork-doc",
    x: opts.x,
    y: opts.y,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    index: opts.index,
    parentId: "page:page",
    meta: {},
    props: {
      w: opts.w,
      h: opts.h,
      docUrl: opts.docUrl,
      docName: opts.docName,
      docType: opts.docType,
      toolId: opts.toolId ?? "",
    },
  };
}
