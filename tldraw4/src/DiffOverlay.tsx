import { createContext, useContext, type CSSProperties } from "react";
import { track, useEditor, type TLShapeId } from "@tldraw/tldraw";
import { type ShapeDiff } from "./diff.ts";

// The diff is computed outside `<Tldraw>` and handed to the overlay
// components through context (they are instantiated by tldraw internally, so
// props can't reach them — context can).
export const DiffContext = createContext<ShapeDiff | null>(null);

const COLORS = {
  added: "#22c55e", // green-500
  changed: "#eab308", // yellow-500
  deleted: "#ef4444", // red-500
};

// Bounding boxes drawn in page space. The `Overlays` slot is rendered inside
// tldraw's camera transform (so page coordinates map straight to CSS — no
// manual zoom/screen conversion) AND in front of the shapes, unlike
// `OnTheCanvas` which sits behind them.
export const DiffOnCanvas = track(function DiffOnCanvas() {
  const editor = useEditor();
  const diff = useContext(DiffContext);
  if (!diff) return null;

  const out: React.ReactNode[] = [];

  for (const id of diff.added) addShapeBox(out, editor, id, "added");
  for (const id of diff.changed) addShapeBox(out, editor, id, "changed");
  for (const record of diff.deleted) addDeletedGhost(out, record);

  return <>{out}</>;
});

function addShapeBox(
  out: React.ReactNode[],
  editor: ReturnType<typeof useEditor>,
  id: TLShapeId,
  kind: "added" | "changed"
) {
  // Page bounds are axis-aligned (rotation already baked in), so the box
  // doesn't need to be rotated.
  const bounds = editor.getShapePageBounds(id);
  if (!bounds) return;
  out.push(
    <div
      key={`${kind}:${id}`}
      style={{
        ...boxBase,
        left: bounds.x,
        top: bounds.y,
        width: bounds.w,
        height: bounds.h,
        border: `2px solid ${COLORS[kind]}`,
        backgroundColor: tint(COLORS[kind]),
      }}
    />
  );
}

function addDeletedGhost(out: React.ReactNode[], record: any) {
  const w = record?.props?.w;
  const h = record?.props?.h;
  const x = typeof record?.x === "number" ? record.x : 0;
  const y = typeof record?.y === "number" ? record.y : 0;
  const rotation = typeof record?.rotation === "number" ? record.rotation : 0;

  // Without explicit dimensions (draw / line / arrow shapes) we can't
  // reconstruct an accurate box, so drop a small marker at the origin.
  const hasSize = typeof w === "number" && typeof h === "number";

  out.push(
    <div
      key={`deleted:${record.id}`}
      style={{
        ...boxBase,
        left: x,
        top: y,
        width: hasSize ? w : 16,
        height: hasSize ? h : 16,
        border: `2px dashed ${COLORS.deleted}`,
        // The deleted shape is gone, so a faint fill marks where it was.
        backgroundColor: tint(COLORS.deleted),
        transform: rotation ? `rotate(${rotation}rad)` : undefined,
        transformOrigin: "0 0",
      }}
    />
  );
}

const boxBase: CSSProperties = {
  position: "absolute",
  boxSizing: "border-box",
  borderRadius: 4,
  pointerEvents: "none",
};

function tint(color: string): string {
  // 12% opacity fill.
  return `${color}1f`;
}

export const diffComponents = {
  Overlays: DiffOnCanvas,
};
