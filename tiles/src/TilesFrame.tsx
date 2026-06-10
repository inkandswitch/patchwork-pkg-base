import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
} from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo";
import type { TilesFrameDoc } from "./types";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { LayoutButton } from "./LayoutButton";
import type { LayoutPreset } from "./LayoutButton";
import { TileCell } from "./TileCell";
import "./styles.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const SNAP_FRACTIONS = [1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 5 / 6];
const SNAP_THRESHOLD = 0.05;
const MIN_TRACK = 0.08;
const DRAG_THRESHOLD = 5;

// ─── Plain-data helpers ───────────────────────────────────────────────────────
//
// Every write to the Automerge doc goes through these helpers. We read the
// current doc into plain JS objects OUTSIDE the change callback, then write
// only those plain objects INSIDE. This avoids Automerge-proxy mutations which
// generate patches with internal element IDs (not numeric indices) that break
// the framework's applyDelPatch listener.
//
// toolId and docUrl are always present as "" so we never generate `del` patches
// when clearing a tile (we overwrite with "" instead of deleting the key).

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
  return Array.from(d?.[field] ?? []).map(Number);
}

// Resolve reference markers to the account doc's live tool settings.
// "@sidebar" → accountSidebarToolId, "@context" → contextSidebarToolId.
// Anything else is a literal tool ID and passes through unchanged.
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

function recomputeTracks(
  tracks: number[],
  handleIndex: number,
  dividerFraction: number
): number[] {
  const total = tracks.reduce((a, b) => a + b, 0);
  const leftSum = tracks.slice(0, handleIndex + 1).reduce((a, b) => a + b, 0);
  const rightSum = total - leftSum;
  const newLeft = dividerFraction * total;
  const newRight = (1 - dividerFraction) * total;
  const ls = leftSum > 0 ? newLeft / leftSum : 0;
  const rs = rightSum > 0 ? newRight / rightSum : 0;
  const raw = tracks.map((t, i) =>
    Math.max(MIN_TRACK * total, i <= handleIndex ? t * ls : t * rs)
  );
  const rawTotal = raw.reduce((a, b) => a + b, 0);
  return raw.map((t) => (t * total) / rawTotal);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface TilesFrameProps {
  handle: DocHandle<TilesFrameDoc>;
  element: ToolElement;
}

const LOG = "[tiles-frame]";

export function TilesFrame(props: TilesFrameProps) {
  console.log(LOG, "mount", { docUrl: props.handle.url });

  // Version-counter pattern: avoids automerge-repo-solid-primitives' internal
  // store listener (which calls applyDelPatch and crashes on our patches).
  //
  // IMPORTANT: when used as the account frame, the account doc changes constantly
  // (sideboard, context tools, annotations, etc. all write to it). We only bump
  // docVersion when the tiles-specific slice of the doc actually changed —
  // otherwise we'd trigger hundreds of unnecessary re-renders.
  const [docVersion, setDocVersion] = createSignal(0);

  let prevFingerprint = "";
  function tilesFingerprint(d: any): string {
    if (!d) return "";
    const tiles = Array.isArray(d.tiles)
      ? d.tiles.map((t: any) =>
          `${t.id}:${t.col},${t.row},${t.colSpan},${t.rowSpan},${t.toolId ?? ""},${t.docUrl ?? ""}`
        ).join("|")
      : "";
    const cols = Array.isArray(d.columnTracks) ? d.columnTracks.join(",") : "";
    const rows = Array.isArray(d.rowTracks) ? d.rowTracks.join(",") : "";
    // Include account slot settings so changing them in settings re-renders the
    // tiles that reference them via @sidebar / @context markers.
    const slots = `${d.accountSidebarToolId ?? ""},${d.contextSidebarToolId ?? ""}`;
    return `${tiles}~${cols}~${rows}~${d.mainTileId ?? ""}~${d.gap ?? 8}~${slots}`;
  }

  createEffect(() => {
    const cb = () => {
      const d = props.handle.doc() as any;
      const fp = tilesFingerprint(d);
      if (fp === prevFingerprint) return; // unrelated account-doc change — skip
      prevFingerprint = fp;
      console.log(LOG, "tiles state changed → version", docVersion() + 1, readTiles(d));
      setDocVersion((v) => v + 1);
    };
    props.handle.on("change", cb);
    onCleanup(() => props.handle.off("change", cb));
  });
  const doc = createMemo(() => {
    docVersion();
    return props.handle.doc() as any;
  });

  // Lazy-init: if this doc has no tile layout yet (e.g. an account doc that just
  // switched frameToolId to "tiles-frame"), populate it with sensible defaults.
  createEffect(() => {
    const d = doc();
    if (!d) return;
    if (Array.isArray(d.tiles) && d.tiles.length > 0) return;
    console.log(LOG, "lazy-init: no tiles found, initialising");
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

  // ── Track resize ──
  let resizeAxis: "col" | "row" | null = null;
  let resizeHandleIdx = -1;
  let containerRef: HTMLDivElement | undefined;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeHasMoved = false;
  const [localColTracks, setLocalColTracks] = createSignal<number[] | null>(null);
  const [localRowTracks, setLocalRowTracks] = createSignal<number[] | null>(null);
  const [isResizing, setIsResizing] = createSignal(false);

  // ── Tile drag ──
  let pendingDragTileId: string | null = null;
  let tileDragStartX = 0;
  let tileDragStartY = 0;
  let tileDragMoved = false;
  const [draggingTileId, setDraggingTileId] = createSignal<string | null>(null);
  const [dropTargetId, setDropTargetId] = createSignal<string | null>(null);

  // ── Tile signals ──
  // Drive <For> by stable string IDs (compared by value) so rows update in place
  // instead of remounting every time Automerge returns fresh object references.
  const tiles = createMemo(() => readTiles(doc()));
  const tileIds = createMemo(() => tiles().map((t) => t.id));
  const tilesById = createMemo(() => {
    const m: Record<string, ReturnType<typeof readTiles>[number]> = {};
    for (const t of tiles()) m[t.id] = t;
    return m;
  });
  const mainTileId = createMemo(() => String(doc()?.mainTileId ?? ""));

  // ── Derived grid signals ──
  const colTracks = createMemo(() => localColTracks() ?? readTracks(doc(), "columnTracks") ?? [1]);
  const rowTracks = createMemo(() => localRowTracks() ?? readTracks(doc(), "rowTracks") ?? [1]);
  const gap = createMemo(() => Number(doc()?.gap ?? 8));

  const colTemplate = createMemo(() => colTracks().map((t) => `${t}fr`).join(" "));
  const rowTemplate = createMemo(() => rowTracks().map((t) => `${t}fr`).join(" "));

  const colHandleFracs = createMemo(() => {
    const t = colTracks();
    const total = t.reduce((a, b) => a + b, 0);
    let cum = 0;
    return t.slice(0, -1).map((v) => { cum += v; return cum / total; });
  });
  const rowHandleFracs = createMemo(() => {
    const t = rowTracks();
    const total = t.reduce((a, b) => a + b, 0);
    let cum = 0;
    return t.slice(0, -1).map((v) => { cum += v; return cum / total; });
  });

  // ── Resize handlers ──
  const startResize = (axis: "col" | "row", idx: number, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeAxis = axis;
    resizeHandleIdx = idx;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeHasMoved = false;
    document.body.style.cursor = axis === "col" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (!resizeAxis || !containerRef) return;
    if (Math.abs(e.clientX - resizeStartX) > 2 || Math.abs(e.clientY - resizeStartY) > 2)
      resizeHasMoved = true;
    if (!resizeHasMoved) return;
    if (!isResizing()) setIsResizing(true);
    const rect = containerRef.getBoundingClientRect();
    const p = gap();
    if (resizeAxis === "col") {
      const raw = (e.clientX - rect.left - p) / (rect.width - 2 * p);
      setLocalColTracks(recomputeTracks(readTracks(doc(), "columnTracks"), resizeHandleIdx, snapValue(Math.max(0.05, Math.min(0.95, raw)))));
    } else {
      const raw = (e.clientY - rect.top - p) / (rect.height - 2 * p);
      setLocalRowTracks(recomputeTracks(readTracks(doc(), "rowTracks"), resizeHandleIdx, snapValue(Math.max(0.05, Math.min(0.95, raw)))));
    }
  };

  const endResize = () => {
    if (!resizeAxis) return;
    if (resizeHasMoved) {
      if (resizeAxis === "col" && localColTracks()) {
        const v = localColTracks()!;
        console.log(LOG, "resize col committed", v);
        props.handle.change((d: any) => { d.columnTracks = v; });
      } else if (resizeAxis === "row" && localRowTracks()) {
        const v = localRowTracks()!;
        console.log(LOG, "resize row committed", v);
        props.handle.change((d: any) => { d.rowTracks = v; });
      }
    }
    resizeAxis = null;
    resizeHasMoved = false;
    setLocalColTracks(null);
    setLocalRowTracks(null);
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  // ── Tile drag handlers ──
  const startTileDrag = (tileId: string, e: MouseEvent) => {
    e.preventDefault();
    pendingDragTileId = tileId;
    tileDragStartX = e.clientX;
    tileDragStartY = e.clientY;
    tileDragMoved = false;
  };

  const handleTileDragMove = (e: MouseEvent) => {
    if (!pendingDragTileId) return;
    if (Math.hypot(e.clientX - tileDragStartX, e.clientY - tileDragStartY) > DRAG_THRESHOLD) {
      tileDragMoved = true;
      if (!draggingTileId()) {
        setDraggingTileId(pendingDragTileId);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
    }
  };

  const endTileDrag = () => {
    if (!pendingDragTileId) return;
    if (!tileDragMoved) {
      // Click on bar = set as main tile
      const id = pendingDragTileId;
      console.log(LOG, "set main tile →", id);
      props.handle.change((d: any) => { d.mainTileId = id; });
    } else {
      const from = draggingTileId();
      const to = dropTargetId();
      if (from && to && from !== to) {
        console.log(LOG, "swap tiles", { from, to });
        // Swap: read outside, write inside (avoid proxy mutations)
        const tiles = readTiles(doc());
        const ai = tiles.findIndex((t) => t.id === from);
        const bi = tiles.findIndex((t) => t.id === to);
        if (ai !== -1 && bi !== -1) {
          const posA = { col: tiles[ai].col, row: tiles[ai].row, colSpan: tiles[ai].colSpan, rowSpan: tiles[ai].rowSpan };
          const posB = { col: tiles[bi].col, row: tiles[bi].row, colSpan: tiles[bi].colSpan, rowSpan: tiles[bi].rowSpan };
          tiles[ai] = { ...tiles[ai], ...posB };
          tiles[bi] = { ...tiles[bi], ...posA };
          props.handle.change((d: any) => { d.tiles = tiles; });
        } else {
          console.warn(LOG, "swap: tile not found", { ai, bi });
        }
      }
    }
    pendingDragTileId = null;
    tileDragMoved = false;
    setDraggingTileId(null);
    setDropTargetId(null);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  // ── Tile content mutations (all use read-outside-write-inside) ──

  const setTile = (tileId: string, toolId: string, docUrl: string) => {
    console.log(LOG, "setTile", { tileId, toolId, docUrl });
    const tiles = readTiles(doc()).map((t) =>
      t.id === tileId ? { ...t, toolId, docUrl } : t
    );
    props.handle.change((d: any) => { d.tiles = tiles; });
  };

  const clearTile = (tileId: string) => {
    console.log(LOG, "clearTile", tileId);
    // Reset to "" — never delete properties (del patches with string keys crash applyDelPatch)
    const tiles = readTiles(doc()).map((t) =>
      t.id === tileId ? { ...t, toolId: "", docUrl: "" } : t
    );
    props.handle.change((d: any) => { d.tiles = tiles; });
  };

  const splitTileRight = (tileId: string) => {
    console.log(LOG, "splitTileRight", tileId);
    const d = doc();
    const tiles = readTiles(d);
    const colTracks = readTracks(d, "columnTracks");
    const ti = tiles.findIndex((t) => t.id === tileId);
    if (ti === -1) { console.warn(LOG, "splitTileRight: tile not found"); return; }
    const tile = tiles[ti];
    const colIdx = tile.col + tile.colSpan - 2;
    const w = colTracks[colIdx];
    const newColTracks = [...colTracks.slice(0, colIdx), w / 2, w / 2, ...colTracks.slice(colIdx + 1)];
    const splitAfter = tile.col + tile.colSpan - 1;
    const newTiles = [
      ...tiles.map((t) => t.id !== tileId && t.col > splitAfter ? { ...t, col: t.col + 1 } : t),
      { id: crypto.randomUUID(), col: splitAfter + 1, row: tile.row, colSpan: 1, rowSpan: tile.rowSpan, toolId: "", docUrl: "" },
    ];
    props.handle.change((d: any) => {
      d.columnTracks = newColTracks;
      d.tiles = newTiles;
    });
  };

  const splitTileDown = (tileId: string) => {
    console.log(LOG, "splitTileDown", tileId);
    const d = doc();
    const tiles = readTiles(d);
    const rTracks = readTracks(d, "rowTracks");
    const ti = tiles.findIndex((t) => t.id === tileId);
    if (ti === -1) { console.warn(LOG, "splitTileDown: tile not found"); return; }
    const tile = tiles[ti];
    const rowIdx = tile.row + tile.rowSpan - 2;
    const w = rTracks[rowIdx];
    const newRowTracks = [...rTracks.slice(0, rowIdx), w / 2, w / 2, ...rTracks.slice(rowIdx + 1)];
    const splitAfter = tile.row + tile.rowSpan - 1;
    const newTiles = [
      ...tiles.map((t) => t.id !== tileId && t.row > splitAfter ? { ...t, row: t.row + 1 } : t),
      { id: crypto.randomUUID(), col: tile.col, row: splitAfter + 1, colSpan: tile.colSpan, rowSpan: 1, toolId: "", docUrl: "" },
    ];
    props.handle.change((d: any) => {
      d.rowTracks = newRowTracks;
      d.tiles = newTiles;
    });
  };

  const applyPreset = (preset: LayoutPreset) => {
    console.log(LOG, "applyPreset", preset.label ?? preset);
    const oldTiles = readTiles(doc());
    const newTiles = preset.tiles.map((t, i) => {
      const old = oldTiles[i];
      return {
        id: old?.id ?? crypto.randomUUID(),
        col: t.col, row: t.row, colSpan: t.colSpan, rowSpan: t.rowSpan,
        toolId: old?.toolId ?? "",
        docUrl: old?.docUrl ?? "",
      };
    });
    const mainId = doc()?.mainTileId;
    const stillValid = newTiles.some((t) => t.id === mainId);
    props.handle.change((d: any) => {
      d.columnTracks = preset.columnTracks;
      d.rowTracks = preset.rowTracks;
      d.tiles = newTiles;
      if (!stillValid) d.mainTileId = newTiles[0]?.id ?? "";
    });
  };

  // ── Mount ──
  onMount(() => {
    // Route patchwork:open-document events to the main tile
    const onOpenDoc = (e: Event) => {
      const evt = e as CustomEvent<{ url: string; toolId?: string }>;
      evt.stopPropagation();
      const { url, toolId } = evt.detail ?? {};
      if (!url) { console.warn(LOG, "open-document: no url in event"); return; }
      const d = doc();
      if (!d) { console.warn(LOG, "open-document: doc not ready"); return; }
      const mainId = d.mainTileId;
      const tiles = readTiles(d);
      const idx = mainId ? tiles.findIndex((t) => t.id === mainId) : 0;
      if (idx === -1 || !tiles[idx]) { console.warn(LOG, "open-document: target tile not found"); return; }

      // toolId from the event is often null → "use the default tool for this doc".
      // We store "" in that case and let patchwork-view resolve the default tool.
      const nextToolId = toolId ? String(toolId) : "";

      // Dedup guard: if the target tile already shows this exact doc+tool, do
      // nothing. Without this, every render re-fires open-document → infinite loop.
      if (tiles[idx].docUrl === url && tiles[idx].toolId === nextToolId) {
        return;
      }

      console.log(LOG, "open-document → tile", tiles[idx].id, { url, toolId: nextToolId || "(default)" });
      const newTiles = tiles.map((t, i) =>
        i !== idx ? t : { ...t, docUrl: url, toolId: nextToolId }
      );
      props.handle.change((d: any) => { d.tiles = newTiles; });
    };
    props.element.addEventListener("patchwork:open-document", onOpenDoc);

    const onMove = (e: MouseEvent) => { handleResizeMove(e); handleTileDragMove(e); };
    const onUp = () => { endResize(); endTileDrag(); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    onCleanup(() => {
      props.element.removeEventListener("patchwork:open-document", onOpenDoc);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    });
  });

  const frameDocUrl = props.handle.url;

  return (
    <div
      ref={containerRef}
      class="tiles-frame"
      style={{
        "grid-template-columns": colTemplate(),
        "grid-template-rows": rowTemplate(),
        gap: `${gap()}px`,
        padding: `${gap()}px`,
        transition: isResizing() || draggingTileId() ? "none"
          : "grid-template-columns 0.18s ease, grid-template-rows 0.18s ease",
      }}
    >
      <For each={tileIds()}>
        {(tileId) => {
          // Reactive accessors so the row updates in place when this tile's
          // data (or the resolved sidebar/context tool) changes.
          const tile = () => tilesById()[tileId];
          const resolvedToolId = () => resolveToolId(tile()?.toolId ?? "", doc());
          return (
            <Show when={tile()}>
              <TileCell
                tile={tile()!}
                frameDocUrl={frameDocUrl}
                resolvedToolId={resolvedToolId()}
                isMain={tileId === mainTileId()}
                isDragging={draggingTileId() === tileId}
                isDropTarget={dropTargetId() === tileId}
                isDragActive={draggingTileId() !== null}
                onSetTile={(toolId, docUrl) => setTile(tileId, toolId, docUrl)}
                onClearTile={() => clearTile(tileId)}
                onBarMouseDown={(e) => startTileDrag(tileId, e)}
                onDropEnter={() => setDropTargetId(tileId)}
                onDropLeave={() => setDropTargetId((prev) => prev === tileId ? null : prev)}
                onSplitRight={() => splitTileRight(tileId)}
                onSplitDown={() => splitTileDown(tileId)}
                onSetMain={() => props.handle.change((d: any) => { d.mainTileId = tileId; })}
              />
            </Show>
          );
        }}
      </For>

      <For each={colHandleFracs()}>
        {(frac, i) => (
          <div
            class={`resize-handle resize-handle--col${isResizing() && resizeAxis === "col" && resizeHandleIdx === i() ? " resize-handle--active" : ""}`}
            style={{ left: `calc(${frac * 100}%)` }}
            onMouseDown={(e) => startResize("col", i(), e)}
          />
        )}
      </For>

      <For each={rowHandleFracs()}>
        {(frac, i) => (
          <div
            class={`resize-handle resize-handle--row${isResizing() && resizeAxis === "row" && resizeHandleIdx === i() ? " resize-handle--active" : ""}`}
            style={{ top: `calc(${frac * 100}%)` }}
            onMouseDown={(e) => startResize("row", i(), e)}
          />
        )}
      </For>

      <LayoutButton onApplyPreset={applyPreset} />
    </div>
  );
}
