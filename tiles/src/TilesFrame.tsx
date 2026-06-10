import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo";
import type { TilesFrameDoc } from "./types";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { LayoutButton } from "./LayoutButton";
import type { LayoutPreset } from "./LayoutButton";
import { TileCell } from "./TileCell";
import { TileContentPicker } from "./TileConfigurator";
import "./styles.css";

const LOG = "[tiles-frame]";

// ─── Constants ────────────────────────────────────────────────────────────────

const SNAP_FRACTIONS = [1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 5 / 6];
const SNAP_THRESHOLD = 0.05;
const MIN_TRACK = 0.08;
const DRAG_THRESHOLD = 5;
const MIN_ROW_PX = 160; // each row keeps at least this height → enables scroll
const MIN_COL_PX = 220; // each column keeps at least this width → enables h-scroll
const GROW_MARGIN = 24; // px past the last track before we add a new track

// ─── Plain-data helpers ───────────────────────────────────────────────────────
// Read the doc into plain JS OUTSIDE handle.change, write plain values INSIDE.
// Avoids Automerge-proxy mutations that crash the framework's patch listener.

type PlainTile = {
  id: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  toolId: string;
  docUrl: string;
};

function readTiles(d: any): PlainTile[] {
  return Array.from(d?.tiles ?? []).map((t: any) => ({
    id: String(t.id ?? ""),
    col: Number(t.col ?? 1),
    row: Number(t.row ?? 1),
    colSpan: Number(t.colSpan ?? 1),
    rowSpan: Number(t.rowSpan ?? 1),
    toolId: t.toolId ? String(t.toolId) : "",
    docUrl: t.docUrl ? String(t.docUrl) : "",
  }));
}

function readTracks(d: any, field: string): number[] {
  const arr = Array.from(d?.[field] ?? []).map(Number);
  return arr.length ? arr : [1];
}

function resolveToolId(toolId: string, d: any): string {
  if (toolId === "@sidebar") return d?.accountSidebarToolId || "";
  if (toolId === "@context") return d?.contextSidebarToolId || "";
  return toolId;
}

function snapValue(raw: number): number {
  for (const s of SNAP_FRACTIONS) {
    if (Math.abs(raw - s) < SNAP_THRESHOLD) return s;
  }
  return raw;
}

function recomputeTracks(tracks: number[], handleIndex: number, dividerFraction: number): number[] {
  const total = tracks.reduce((a, b) => a + b, 0);
  const leftSum = tracks.slice(0, handleIndex + 1).reduce((a, b) => a + b, 0);
  const rightSum = total - leftSum;
  const ls = leftSum > 0 ? (dividerFraction * total) / leftSum : 0;
  const rs = rightSum > 0 ? ((1 - dividerFraction) * total) / rightSum : 0;
  const raw = tracks.map((t, i) => Math.max(MIN_TRACK * total, i <= handleIndex ? t * ls : t * rs));
  const rawTotal = raw.reduce((a, b) => a + b, 0);
  return raw.map((t) => (t * total) / rawTotal);
}

// ─── Occupancy helpers (1-indexed col/row) ──────────────────────────────────────

type Occ = Record<string, string>; // "col,row" → tileId

function buildOcc(tiles: PlainTile[]): Occ {
  const occ: Occ = {};
  for (const t of tiles) {
    for (let r = t.row; r < t.row + t.rowSpan; r++)
      for (let c = t.col; c < t.col + t.colSpan; c++) occ[`${c},${r}`] = t.id;
  }
  return occ;
}

// Is the rectangle blocked by another tile (in-grid) or out of bounds (top/left)?
// Cells past the right/bottom edge are allowed — that's how we grow the grid.
function regionBlocked(
  occ: Occ, col: number, row: number, colSpan: number, rowSpan: number, ignoreId: string
): boolean {
  if (col < 1 || row < 1) return true;
  for (let r = row; r < row + rowSpan; r++)
    for (let c = col; c < col + colSpan; c++) {
      const owner = occ[`${c},${r}`];
      if (owner && owner !== ignoreId) return true;
    }
  return false;
}

// Parse the grid's actual rendered track sizes (px) and gap from the DOM.
function gridGeometry(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const cols = cs.gridTemplateColumns.split(" ").map(parseFloat).filter((n) => !isNaN(n));
  const rows = cs.gridTemplateRows.split(" ").map(parseFloat).filter((n) => !isNaN(n));
  const colGap = parseFloat(cs.columnGap) || 0;
  const rowGap = parseFloat(cs.rowGap) || 0;
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const rect = el.getBoundingClientRect();
  // Column bands [startX, endX] in client coordinates
  const colBands: [number, number][] = [];
  let x = rect.left + padL - el.scrollLeft;
  for (const w of cols) { colBands.push([x, x + w]); x += w + colGap; }
  const rowBands: [number, number][] = [];
  let y = rect.top + padT - el.scrollTop;
  for (const h of rows) { rowBands.push([y, y + h]); y += h + rowGap; }
  return { colBands, rowBands };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface TilesFrameProps {
  handle: DocHandle<TilesFrameDoc>;
  element: ToolElement;
}

export function TilesFrame(props: TilesFrameProps) {
  console.log(LOG, "mount", { docUrl: props.handle.url });

  // Doc subscription with tiles-only fingerprint (account doc changes a lot).
  const [docVersion, setDocVersion] = createSignal(0);
  let prevFingerprint = "";
  function fingerprint(d: any): string {
    if (!d) return "";
    const tiles = Array.isArray(d.tiles)
      ? d.tiles.map((t: any) => `${t.id}:${t.col},${t.row},${t.colSpan},${t.rowSpan},${t.toolId ?? ""},${t.docUrl ?? ""}`).join("|")
      : "";
    const cols = Array.isArray(d.columnTracks) ? d.columnTracks.join(",") : "";
    const rows = Array.isArray(d.rowTracks) ? d.rowTracks.join(",") : "";
    const slots = `${d.accountSidebarToolId ?? ""},${d.contextSidebarToolId ?? ""}`;
    return `${tiles}~${cols}~${rows}~${d.mainTileId ?? ""}~${d.gap ?? 8}~${slots}`;
  }
  createEffect(() => {
    const cb = () => {
      const fp = fingerprint(props.handle.doc() as any);
      if (fp === prevFingerprint) return;
      prevFingerprint = fp;
      setDocVersion((v) => v + 1);
    };
    props.handle.on("change", cb);
    onCleanup(() => props.handle.off("change", cb));
  });
  const doc = createMemo(() => {
    docVersion();
    return props.handle.doc() as any;
  });

  // Lazy-init when there is no tile layout yet.
  createEffect(() => {
    const d = doc();
    if (!d) return;
    if (Array.isArray(d.tiles) && d.tiles.length > 0) return;
    const sideId = crypto.randomUUID();
    const mainId = crypto.randomUUID();
    props.handle.change((draft: any) => {
      if (Array.isArray(draft.tiles) && draft.tiles.length > 0) return;
      draft.columnTracks = [1, 3];
      draft.rowTracks = [1];
      draft.gap = 8;
      draft.mainTileId = mainId;
      draft.tiles = [
        { id: sideId, col: 1, row: 1, colSpan: 1, rowSpan: 1, toolId: "", docUrl: "" },
        { id: mainId, col: 2, row: 1, colSpan: 1, rowSpan: 1, toolId: "", docUrl: "" },
      ];
    });
  });

  let containerRef: HTMLDivElement | undefined;

  // ── Base (committed) state ──
  const baseTiles = createMemo(() => readTiles(doc()));
  const baseCols = createMemo(() => readTracks(doc(), "columnTracks"));
  const baseRows = createMemo(() => readTracks(doc(), "rowTracks"));
  const mainTileId = createMemo(() => String(doc()?.mainTileId ?? ""));
  const gap = createMemo(() => Number(doc()?.gap ?? 8));

  // ── Interaction preview overrides (null when idle) ──
  const [previewTiles, setPreviewTiles] = createSignal<PlainTile[] | null>(null);
  const [previewCols, setPreviewCols] = createSignal<number[] | null>(null);
  const [previewRows, setPreviewRows] = createSignal<number[] | null>(null);
  const [ghost, setGhost] = createSignal<{ col: number; row: number; colSpan: number; rowSpan: number; valid: boolean } | null>(null);
  // Divider-resize live overrides
  const [localColTracks, setLocalColTracks] = createSignal<number[] | null>(null);
  const [localRowTracks, setLocalRowTracks] = createSignal<number[] | null>(null);
  const [isInteracting, setIsInteracting] = createSignal(false);
  const [activeMoveId, setActiveMoveId] = createSignal<string | null>(null);
  // Drag-a-file-from-sideboard placement preview
  const [placeGhost, setPlaceGhost] = createSignal<{ col: number; row: number } | null>(null);

  // ── Displayed (merged) state ──
  const tiles = createMemo(() => previewTiles() ?? baseTiles());
  const cols = createMemo(() => previewCols() ?? localColTracks() ?? baseCols());
  const rows = createMemo(() => previewRows() ?? localRowTracks() ?? baseRows());
  const tileIds = createMemo(() => tiles().map((t) => t.id));
  const tilesById = createMemo(() => {
    const m: Record<string, PlainTile> = {};
    for (const t of tiles()) m[t.id] = t;
    return m;
  });

  // minmax tracks keep a minimum px size: baseline layouts fill the viewport
  // (fr), but once tiles are added/extended past the edge the grid grows and the
  // wrapper scrolls instead of squashing everything.
  const colTemplate = createMemo(() => cols().map((t) => `minmax(${MIN_COL_PX}px, ${t}fr)`).join(" "));
  const rowTemplate = createMemo(() => rows().map((t) => `minmax(${MIN_ROW_PX}px, ${t}fr)`).join(" "));

  // Empty cells (uncovered) → fillable drop zones
  const emptyCells = createMemo(() => {
    const occ = buildOcc(tiles());
    const out: { col: number; row: number }[] = [];
    const nCols = cols().length;
    const nRows = rows().length;
    for (let r = 1; r <= nRows; r++)
      for (let c = 1; c <= nCols; c++) if (!occ[`${c},${r}`]) out.push({ col: c, row: r });
    return out;
  });

  // ── Divider resize handle positions ──
  const colHandleFracs = createMemo(() => {
    const t = cols();
    const total = t.reduce((a, b) => a + b, 0);
    let cum = 0;
    return t.slice(0, -1).map((v) => { cum += v; return cum / total; });
  });
  const rowHandleFracs = createMemo(() => {
    const t = rows();
    const total = t.reduce((a, b) => a + b, 0);
    let cum = 0;
    return t.slice(0, -1).map((v) => { cum += v; return cum / total; });
  });

  // ─── Interaction state machine ───────────────────────────────────────────────
  type Mode =
    | { kind: "none" }
    | { kind: "divider"; axis: "col" | "row"; idx: number; startX: number; startY: number; moved: boolean }
    | { kind: "move"; tileId: string; grabDC: number; grabDR: number; startX: number; startY: number; moved: boolean }
    | { kind: "resize"; tileId: string; moved: boolean };
  let mode: Mode = { kind: "none" };

  const resetCursor = () => {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  const clearPreviews = () => {
    setPreviewTiles(null);
    setPreviewCols(null);
    setPreviewRows(null);
    setGhost(null);
    setLocalColTracks(null);
    setLocalRowTracks(null);
    setIsInteracting(false);
    setActiveMoveId(null);
  };

  // Which grid cell (1-indexed) is the client point over? Clamps to nearest.
  const cellAtPoint = (clientX: number, clientY: number) => {
    if (!containerRef) return { col: 1, row: 1, pastRight: false, pastBottom: false };
    const { colBands, rowBands } = gridGeometry(containerRef);
    let col = 1, pastRight = false;
    if (colBands.length) {
      if (clientX < colBands[0][0]) col = 1;
      else if (clientX > colBands[colBands.length - 1][1] + GROW_MARGIN) { col = colBands.length + 1; pastRight = true; }
      else { col = colBands.findIndex(([s, e]) => clientX <= e + (e - s) / 2 || clientX <= e); col = col === -1 ? colBands.length : col + 1; }
    }
    let row = 1, pastBottom = false;
    if (rowBands.length) {
      if (clientY < rowBands[0][0]) row = 1;
      else if (clientY > rowBands[rowBands.length - 1][1] + GROW_MARGIN) { row = rowBands.length + 1; pastBottom = true; }
      else { row = rowBands.findIndex(([, e]) => clientY <= e); row = row === -1 ? rowBands.length : row + 1; }
    }
    return { col, row, pastRight, pastBottom };
  };

  // ── Start interactions ──
  const startDivider = (axis: "col" | "row", idx: number, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    mode = { kind: "divider", axis, idx, startX: e.clientX, startY: e.clientY, moved: false };
    document.body.style.cursor = axis === "col" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };
  const startMove = (tileId: string, e: MouseEvent) => {
    e.preventDefault();
    const tile = tilesById()[tileId];
    if (!tile || !containerRef) return;
    const { col, row } = cellAtPoint(e.clientX, e.clientY);
    mode = {
      kind: "move", tileId,
      grabDC: Math.max(0, Math.min(tile.colSpan - 1, col - tile.col)),
      grabDR: Math.max(0, Math.min(tile.rowSpan - 1, row - tile.row)),
      startX: e.clientX, startY: e.clientY, moved: false,
    };
  };
  const startResize = (tileId: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    mode = { kind: "resize", tileId, moved: false };
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
  };

  // ── Mouse move ──
  const onMove = (e: MouseEvent) => {
    // Snapshot into a const so TS narrowing survives the function calls below.
    const m = mode;
    if (m.kind === "none") return;

    if (m.kind === "divider") {
      if (Math.abs(e.clientX - m.startX) > 2 || Math.abs(e.clientY - m.startY) > 2) m.moved = true;
      if (!m.moved || !containerRef) return;
      setIsInteracting(true);
      const rect = containerRef.getBoundingClientRect();
      const p = gap();
      if (m.axis === "col") {
        const raw = (e.clientX - rect.left - p) / (rect.width - 2 * p);
        setLocalColTracks(recomputeTracks(baseCols(), m.idx, snapValue(Math.max(0.05, Math.min(0.95, raw)))));
      } else {
        const raw = (e.clientY - rect.top - p) / (rect.height - 2 * p);
        setLocalRowTracks(recomputeTracks(baseRows(), m.idx, snapValue(Math.max(0.05, Math.min(0.95, raw)))));
      }
      return;
    }

    if (m.kind === "move") {
      if (!m.moved && Math.hypot(e.clientX - m.startX, e.clientY - m.startY) > DRAG_THRESHOLD) {
        m.moved = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        setIsInteracting(true);
        setActiveMoveId(m.tileId);
      }
      if (!m.moved) return;
      const tile = baseTiles().find((t) => t.id === m.tileId);
      if (!tile) return;
      const nCols = baseCols().length, nRows = baseRows().length;
      const { col, row } = cellAtPoint(e.clientX, e.clientY);
      const targetCol = Math.max(1, Math.min(nCols - tile.colSpan + 1, col - m.grabDC));
      const targetRow = Math.max(1, Math.min(nRows - tile.rowSpan + 1, row - m.grabDR));
      const occ = buildOcc(baseTiles());
      const free = !regionBlocked(occ, targetCol, targetRow, tile.colSpan, tile.rowSpan, tile.id);
      setGhost({ col: targetCol, row: targetRow, colSpan: tile.colSpan, rowSpan: tile.rowSpan, valid: free || canSwap(tile, targetCol, targetRow) });
      return;
    }

    if (m.kind === "resize") {
      m.moved = true;
      setIsInteracting(true);
      const tile = baseTiles().find((t) => t.id === m.tileId);
      if (!tile) return;
      const baseColsArr = baseCols(), baseRowsArr = baseRows();
      const { col, row } = cellAtPoint(e.clientX, e.clientY);
      let desiredColSpan = Math.max(1, col - tile.col + 1);
      let desiredRowSpan = Math.max(1, row - tile.row + 1);
      const occ = buildOcc(baseTiles());
      // Clamp each axis down until the rectangle no longer overlaps a neighbor.
      while (desiredColSpan > 1 && regionBlocked(occ, tile.col, tile.row, desiredColSpan, desiredRowSpan, tile.id)) desiredColSpan--;
      while (desiredRowSpan > 1 && regionBlocked(occ, tile.col, tile.row, desiredColSpan, desiredRowSpan, tile.id)) desiredRowSpan--;
      // Grow grid if extending past the current edge
      const needCols = tile.col + desiredColSpan - 1;
      const needRows = tile.row + desiredRowSpan - 1;
      const newCols = needCols > baseColsArr.length
        ? [...baseColsArr, ...Array(needCols - baseColsArr.length).fill(1)] : baseColsArr;
      const newRows = needRows > baseRowsArr.length
        ? [...baseRowsArr, ...Array(needRows - baseRowsArr.length).fill(1)] : baseRowsArr;
      setPreviewCols(newCols);
      setPreviewRows(newRows);
      setPreviewTiles(baseTiles().map((t) => t.id === tile.id ? { ...t, colSpan: desiredColSpan, rowSpan: desiredRowSpan } : t));
      return;
    }
  };

  // Can the dragged tile swap with a single same-size tile at the target?
  const canSwap = (tile: PlainTile, targetCol: number, targetRow: number): boolean => {
    const others = baseTiles().filter((t) => t.id !== tile.id);
    const occOther = buildOcc(others);
    const ids = new Set<string>();
    for (let r = targetRow; r < targetRow + tile.rowSpan; r++)
      for (let c = targetCol; c < targetCol + tile.colSpan; c++) { const o = occOther[`${c},${r}`]; if (o) ids.add(o); }
    if (ids.size !== 1) return false;
    const other = others.find((t) => t.id === [...ids][0])!;
    return other.colSpan === tile.colSpan && other.rowSpan === tile.rowSpan;
  };

  // ── Mouse up — commit ──
  const onUp = () => {
    const m = mode;
    mode = { kind: "none" };

    if (m.kind === "divider") {
      if (m.moved) {
        if (m.axis === "col" && localColTracks()) { const v = localColTracks()!; props.handle.change((d: any) => { d.columnTracks = v; }); }
        else if (m.axis === "row" && localRowTracks()) { const v = localRowTracks()!; props.handle.change((d: any) => { d.rowTracks = v; }); }
      }
    } else if (m.kind === "move") {
      if (!m.moved) {
        // Click on bar = make this the document target
        props.handle.change((d: any) => { d.mainTileId = m.tileId; });
      } else {
        const g = ghost();
        const tile = baseTiles().find((t) => t.id === m.tileId);
        if (g && g.valid && tile) {
          const occ = buildOcc(baseTiles());
          if (!regionBlocked(occ, g.col, g.row, tile.colSpan, tile.rowSpan, tile.id)) {
            // Move into empty space
            const next = baseTiles().map((t) => t.id === tile.id ? { ...t, col: g.col, row: g.row } : t);
            console.log(LOG, "move tile", tile.id, "→", { col: g.col, row: g.row });
            props.handle.change((d: any) => { d.tiles = next; });
          } else if (canSwap(tile, g.col, g.row)) {
            // Swap with the single same-size neighbor
            const others = baseTiles().filter((t) => t.id !== tile.id);
            const occOther = buildOcc(others);
            const otherId = occOther[`${g.col},${g.row}`];
            const oldCol = tile.col, oldRow = tile.row;
            const next = baseTiles().map((t) => {
              if (t.id === tile.id) return { ...t, col: g.col, row: g.row };
              if (t.id === otherId) return { ...t, col: oldCol, row: oldRow };
              return t;
            });
            console.log(LOG, "swap tiles", tile.id, "↔", otherId);
            props.handle.change((d: any) => { d.tiles = next; });
          }
        }
      }
    } else if (m.kind === "resize") {
      if (m.moved) {
        const pt = previewTiles(), pc = previewCols(), pr = previewRows();
        if (pt) {
          console.log(LOG, "resize tile", m.tileId);
          props.handle.change((d: any) => {
            d.tiles = pt;
            if (pc) d.columnTracks = pc;
            if (pr) d.rowTracks = pr;
          });
        }
      }
    }

    clearPreviews();
    resetCursor();
  };

  // ─── Tile content mutations ──────────────────────────────────────────────────
  const setTile = (tileId: string, toolId: string, docUrl: string) => {
    const next = readTiles(doc()).map((t) => t.id === tileId ? { ...t, toolId, docUrl } : t);
    props.handle.change((d: any) => { d.tiles = next; });
  };
  const clearTile = (tileId: string) => {
    const next = readTiles(doc()).map((t) => t.id === tileId ? { ...t, toolId: "", docUrl: "" } : t);
    props.handle.change((d: any) => { d.tiles = next; });
  };
  // Remove a tile entirely → leaves open space
  const removeTile = (tileId: string) => {
    const next = readTiles(doc()).filter((t) => t.id !== tileId);
    props.handle.change((d: any) => { d.tiles = next; });
  };
  // Create a tile in a previously-empty cell
  const addTileAt = (col: number, row: number, toolId: string, docUrl: string) => {
    const id = crypto.randomUUID();
    const next = [...readTiles(doc()), { id, col, row, colSpan: 1, rowSpan: 1, toolId, docUrl }];
    props.handle.change((d: any) => { d.tiles = next; });
  };

  // '+' on a tile header: split its last column in two and drop an empty block
  // beside it. Keeps everything within the current width (no scroll needed).
  const addBlockBeside = (tileId: string) => {
    const d = doc();
    const tiles = readTiles(d);
    const colTracks = readTracks(d, "columnTracks");
    const ti = tiles.findIndex((t) => t.id === tileId);
    if (ti === -1) return;
    const tile = tiles[ti];
    const colIdx = tile.col + tile.colSpan - 2; // 0-based last column of the tile
    const w = colTracks[colIdx] ?? 1;
    const newColTracks = [...colTracks.slice(0, colIdx), w / 2, w / 2, ...colTracks.slice(colIdx + 1)];
    const splitAfter = tile.col + tile.colSpan - 1; // 1-based
    const shifted = tiles.map((t) => (t.id !== tileId && t.col > splitAfter ? { ...t, col: t.col + 1 } : t));
    const next = [
      ...shifted,
      { id: crypto.randomUUID(), col: splitAfter + 1, row: tile.row, colSpan: 1, rowSpan: tile.rowSpan, toolId: "", docUrl: "" },
    ];
    props.handle.change((dd: any) => { dd.columnTracks = newColTracks; dd.tiles = next; });
  };

  const applyPreset = (preset: LayoutPreset) => {
    const oldTiles = readTiles(doc());
    const newTiles = preset.tiles.map((t, i) => {
      const old = oldTiles[i];
      return {
        id: old?.id ?? crypto.randomUUID(),
        col: t.col, row: t.row, colSpan: t.colSpan, rowSpan: t.rowSpan,
        toolId: old?.toolId ?? "", docUrl: old?.docUrl ?? "",
      };
    });
    const stillValid = newTiles.some((t) => t.id === doc()?.mainTileId);
    props.handle.change((d: any) => {
      d.columnTracks = preset.columnTracks;
      d.rowTracks = preset.rowTracks;
      d.tiles = newTiles;
      if (!stillValid) d.mainTileId = newTiles[0]?.id ?? "";
    });
  };

  // ─── Mount: events ───────────────────────────────────────────────────────────
  onMount(() => {
    const onOpenDoc = (e: Event) => {
      const evt = e as CustomEvent<{ url: string; toolId?: string }>;
      evt.stopPropagation();
      const { url, toolId } = evt.detail ?? {};
      if (!url) return;
      const d = doc();
      if (!d) return;
      const mId = d.mainTileId;
      const ts = readTiles(d);
      const idx = mId ? ts.findIndex((t) => t.id === mId) : 0;
      if (idx === -1 || !ts[idx]) return;
      const nextToolId = toolId ? String(toolId) : "";
      if (ts[idx].docUrl === url && ts[idx].toolId === nextToolId) return;
      console.log(LOG, "open-document → tile", ts[idx].id, { url, toolId: nextToolId || "(default)" });
      const next = ts.map((t, i) => i !== idx ? t : { ...t, docUrl: url, toolId: nextToolId });
      props.handle.change((dd: any) => { dd.tiles = next; });
    };
    props.element.addEventListener("patchwork:open-document", onOpenDoc);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    onCleanup(() => {
      props.element.removeEventListener("patchwork:open-document", onOpenDoc);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      resetCursor();
    });
  });

  const frameDocUrl = props.handle.url;

  // ─── Drag a file from the sideboard → placeable tool ─────────────────────────
  // Best-effort: read an automerge URL out of the native drag dataTransfer, show
  // a placement ghost on dragover, and create/replace a tile on drop.
  const extractUrl = (dt: DataTransfer): string | null => {
    const types = Array.from(dt.types || []);
    for (const ty of ["text/uri-list", "text/plain", ...types]) {
      try {
        const v = dt.getData(ty);
        const m = v && v.match(/automerge:[A-Za-z0-9]+/);
        if (m) return m[0];
      } catch { /* some types throw on getData during dragover */ }
    }
    return null;
  };
  const clampedCell = (clientX: number, clientY: number) => {
    const { col, row } = cellAtPoint(clientX, clientY);
    return { col: Math.min(col, cols().length), row: Math.min(row, rows().length) };
  };
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setPlaceGhost(clampedCell(e.clientX, e.clientY));
  };
  const onDragLeave = (e: DragEvent) => {
    if (e.relatedTarget && containerRef?.contains(e.relatedTarget as Node)) return;
    setPlaceGhost(null);
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    console.log(LOG, "drop dataTransfer types:", Array.from(e.dataTransfer.types || []));
    const url = extractUrl(e.dataTransfer);
    const g = placeGhost();
    setPlaceGhost(null);
    if (!url) { console.warn(LOG, "drop: no automerge: URL found in dataTransfer"); return; }
    if (!g) return;
    const occ = buildOcc(baseTiles());
    const ownerId = occ[`${g.col},${g.row}`];
    if (ownerId) setTile(ownerId, "", url); // replace doc in the targeted block
    else addTileAt(g.col, g.row, "", url); // drop into open space
    console.log(LOG, "placed dropped doc", url, "at", g);
  };

  return (
    <div class="tiles-scroll">
      <div
        ref={containerRef}
        class="tiles-frame"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          "grid-template-columns": colTemplate(),
          "grid-template-rows": rowTemplate(),
          gap: `${gap()}px`,
          padding: `${gap()}px`,
          transition: isInteracting() ? "none" : "grid-template-columns 0.18s ease, grid-template-rows 0.18s ease",
        }}
      >
        {/* ── Empty cells ── */}
        <For each={emptyCells()}>
          {(cell) => (
            <div class="empty-cell" style={{ "grid-column": `${cell.col}`, "grid-row": `${cell.row}` }}>
              <TileContentPicker
                frameDocUrl={frameDocUrl}
                onSet={(toolId, docUrl) => addTileAt(cell.col, cell.row, toolId, docUrl)}
              />
            </div>
          )}
        </For>

        {/* ── Tiles ── */}
        <For each={tileIds()}>
          {(tileId) => {
            const tile = () => tilesById()[tileId];
            const resolvedToolId = () => resolveToolId(tile()?.toolId ?? "", doc());
            return (
              <Show when={tile()}>
                <TileCell
                  tile={tile()!}
                  frameDocUrl={frameDocUrl}
                  resolvedToolId={resolvedToolId()}
                  isMain={tileId === mainTileId()}
                  isDragging={activeMoveId() === tileId}
                  onSetTile={(toolId, docUrl) => setTile(tileId, toolId, docUrl)}
                  onClearTile={() => clearTile(tileId)}
                  onRemove={() => removeTile(tileId)}
                  onBarMouseDown={(e) => startMove(tileId, e)}
                  onResizeMouseDown={(e) => startResize(tileId, e)}
                  onAddBlock={() => addBlockBeside(tileId)}
                  onSetMain={() => props.handle.change((d: any) => { d.mainTileId = tileId; })}
                />
              </Show>
            );
          }}
        </For>

        {/* ── Move ghost ── */}
        <Show when={ghost()}>
          {(g) => (
            <div
              class={`move-ghost${g().valid ? " move-ghost--valid" : " move-ghost--invalid"}`}
              style={{
                "grid-column": `${g().col} / span ${g().colSpan}`,
                "grid-row": `${g().row} / span ${g().rowSpan}`,
              }}
            />
          )}
        </Show>

        {/* ── Drop-from-sideboard placement ghost ── */}
        <Show when={placeGhost()}>
          {(g) => (
            <div
              class="move-ghost move-ghost--valid"
              style={{ "grid-column": `${g().col}`, "grid-row": `${g().row}` }}
            />
          )}
        </Show>

        {/* ── Divider resize handles ── */}
        <For each={colHandleFracs()}>
          {(frac, i) => (
            <div
              class="resize-handle resize-handle--col"
              style={{ left: `calc(${frac * 100}%)` }}
              onMouseDown={(e) => startDivider("col", i(), e)}
            />
          )}
        </For>
        <For each={rowHandleFracs()}>
          {(frac, i) => (
            <div
              class="resize-handle resize-handle--row"
              style={{ top: `calc(${frac * 100}%)` }}
              onMouseDown={(e) => startDivider("row", i(), e)}
            />
          )}
        </For>

        <LayoutButton onApplyPreset={applyPreset} />
      </div>
    </div>
  );
}
