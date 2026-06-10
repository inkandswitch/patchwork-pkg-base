import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { createGridview, GridviewPanel, Orientation } from "dockview-core";
import type {
  GridviewApi,
  IFrameworkPart,
  IGridviewPanel,
} from "dockview-core";
import type { DocHandle } from "@automerge/automerge-repo";
import type { TileContent, TilesFrameDoc } from "./types";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { LayoutButton } from "./LayoutButton";
import type { PresetKey } from "./LayoutButton";
import { TileView } from "./TileView";
import type { TileCtx } from "./TileView";
import "dockview-core/dist/styles/dockview.css";
import "./styles.css";

const LOG = "[tiles-frame]";
const DRAG_THRESHOLD = 5;
const uid = () => crypto.randomUUID();

// dockview's toJSON() leaves `params: undefined` on panels we didn't give params
// to. Automerge rejects undefined values, so round-trip through JSON to drop them.
const cleanJSON = (o: any) => JSON.parse(JSON.stringify(o));

interface TilesFrameProps {
  handle: DocHandle<TilesFrameDoc>;
  element: ToolElement;
}

export function TilesFrame(props: TilesFrameProps) {
  const frameDocUrl = props.handle.url;

  // ── Doc subscription (fingerprint on content/main/slots, NOT layout — the
  //    gridview owns the layout and reacts to it imperatively) ──
  const [docVersion, setDocVersion] = createSignal(0);
  let prevFingerprint = "";
  const fingerprint = (d: any): string => {
    if (!d) return "";
    const content = d.content
      ? Object.entries(d.content)
          .map(([k, v]: any) => `${k}:${v?.toolId ?? ""},${v?.docUrl ?? ""}`)
          .sort()
          .join("|")
      : "";
    return `${content}~${d.mainTileId ?? ""}~${d.accountSidebarToolId ?? ""}~${d.contextSidebarToolId ?? ""}`;
  };
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

  // ── Content read/write ──
  const readContent = (d: any): Record<string, TileContent> => {
    const out: Record<string, TileContent> = {};
    const c = d?.content ?? {};
    for (const k of Object.keys(c)) {
      out[k] = { toolId: c[k]?.toolId ? String(c[k].toolId) : "", docUrl: c[k]?.docUrl ? String(c[k].docUrl) : "" };
    }
    return out;
  };
  const contentSig = createMemo(() => readContent(doc()));
  const mainTileId = createMemo(() => String(doc()?.mainTileId ?? ""));

  const writeContent = (next: Record<string, TileContent>, main?: string) => {
    props.handle.change((d: any) => {
      d.content = next;
      if (main !== undefined) d.mainTileId = main;
    });
  };

  // ── Drag-to-move state (header grabber) ──
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  let dragStart: { id: string; x: number; y: number; moved: boolean } | null = null;

  // Bumped on structural layout changes (move/add/remove/preset). dockview
  // reparents panel elements on these, which disconnects our patchwork-view
  // custom elements; remounting via this key re-initializes the embedded tool.
  const [structGen, setStructGen] = createSignal(0);
  const bumpStruct = () => setStructGen((v) => v + 1);

  // dockview gridview instance
  let gridview: GridviewApi | undefined;
  let suppressSave = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const saveLayout = () => {
    if (suppressSave || !gridview) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!gridview) return;
      const layout = cleanJSON(gridview.toJSON());
      props.handle.change((d: any) => { d.layout = layout; });
    }, 200);
  };

  // ── Content mutations (no layout rebuild) ──
  const setTile = (id: string, toolId: string, docUrl: string) => {
    const next = { ...contentSig(), [id]: { toolId, docUrl } };
    writeContent(next);
  };
  const setMain = (id: string) => {
    props.handle.change((d: any) => { d.mainTileId = id; });
  };
  const clearTile = (id: string) => {
    const next = { ...contentSig(), [id]: { toolId: "", docUrl: "" } };
    writeContent(next);
  };

  // ── Layout mutations (via gridview) ──
  const addBlock = (besideId: string, direction: "above" | "below" | "left" | "right" = "right") => {
    if (!gridview) return;
    const id = uid();
    gridview.addPanel({
      id,
      component: "tile",
      position: { direction, referencePanel: besideId },
    });
    const next = { ...contentSig(), [id]: { toolId: "", docUrl: "" } };
    writeContent(next);
    bumpStruct();
    saveLayout();
  };

  const removeTile = (id: string) => {
    if (!gridview) return;
    const panel = gridview.getPanel(id);
    if (!panel || gridview.panels.length <= 1) return;
    gridview.removePanel(panel);
    const next = { ...contentSig() };
    delete next[id];
    const newMain = mainTileId() === id ? (gridview.panels[0]?.id ?? "") : undefined;
    writeContent(next, newMain);
    bumpStruct();
    saveLayout();
  };

  // ── Header drag (move panels) ──
  const onHeaderDown = (id: string, e: MouseEvent) => {
    e.preventDefault();
    dragStart = { id, x: e.clientX, y: e.clientY, moved: false };
  };
  const onDocMove = (e: MouseEvent) => {
    if (!dragStart) return;
    if (!dragStart.moved && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > DRAG_THRESHOLD) {
      dragStart.moved = true;
      setDraggingId(dragStart.id);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }
  };
  const onDocUp = (e: MouseEvent) => {
    const ds = dragStart;
    dragStart = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setDraggingId(null);
    if (!ds || !gridview) return;

    if (!ds.moved) {
      setMain(ds.id); // click = set document target
      return;
    }
    // Drop: find the panel under the cursor and dock relative to it
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const host = el?.closest("[data-tile-id]") as HTMLElement | null;
    const targetId = host?.dataset.tileId;
    if (!targetId || targetId === ds.id) return;
    const rect = host!.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    // Nearest edge → dock direction
    const distLeft = relX, distRight = 1 - relX, distTop = relY, distBottom = 1 - relY;
    const min = Math.min(distLeft, distRight, distTop, distBottom);
    const direction =
      min === distLeft ? "left" : min === distRight ? "right" : min === distTop ? "above" : "below";
    const panel = gridview.getPanel(ds.id);
    if (panel) {
      gridview.movePanel(panel, { direction: direction as any, reference: targetId });
      bumpStruct();
      saveLayout();
    }
  };

  // ── Presets ──
  const applyPreset = (key: PresetKey) => {
    if (!gridview) return;
    const oldContent = contentSig();
    const oldIds = gridview.panels.map((p) => p.id);
    suppressSave = true;
    gridview.clear();

    const ids: string[] = [];
    const add = (position?: { direction: "right" | "below"; referencePanel: string }) => {
      const id = uid();
      gridview!.addPanel({ id, component: "tile", position });
      ids.push(id);
      return id;
    };

    if (key === "single") {
      add();
    } else if (key === "sidebar-main" || key === "two-col") {
      const a = add();
      add({ direction: "right", referencePanel: a });
    } else if (key === "main-split") {
      const a = add();
      const b = add({ direction: "right", referencePanel: a });
      add({ direction: "below", referencePanel: b });
    }
    suppressSave = false;

    // Carry old content into the new panels by order
    const next: Record<string, TileContent> = {};
    ids.forEach((id, i) => {
      const old = oldIds[i];
      next[id] = old && oldContent[old] ? oldContent[old] : { toolId: "", docUrl: "" };
    });
    writeContent(next, ids[ids.length - 1]);
    bumpStruct();
    saveLayout();
  };

  // ── The context handed to every panel ──
  const ctx: TileCtx = {
    content: (id) => contentSig()[id],
    mainTileId,
    doc,
    frameDocUrl,
    draggingId,
    structGen,
    onHeaderDown,
    addBlock,
    removeTile,
    clearTile,
    setTile,
  };

  // ── Build a fresh default layout (first mount) ──
  const buildDefault = () => {
    if (!gridview) return;
    const a = uid();
    const b = uid();
    suppressSave = true;
    gridview.addPanel({ id: a, component: "tile" });
    gridview.addPanel({ id: b, component: "tile", position: { direction: "right", referencePanel: a } });
    suppressSave = false;
    props.handle.change((d: any) => {
      d.content = {
        [a]: { toolId: "@sidebar", docUrl: frameDocUrl },
        [b]: { toolId: "", docUrl: "" },
      };
      d.mainTileId = b;
      d.layout = cleanJSON(gridview!.toJSON());
    });
  };

  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    // Panel implementation: render the Solid TileView into the panel element.
    class TilePanel extends GridviewPanel {
      private _dispose?: () => void;
      getComponent(): IFrameworkPart {
        const tileId = this.id;
        this._dispose = render(() => TileView({ tileId, ctx }), this.element);
        return {
          update: () => {},
          dispose: () => this._dispose?.(),
        };
      }
    }

    gridview = createGridview(containerRef!, {
      orientation: Orientation.HORIZONTAL,
      proportionalLayout: true,
      createComponent: (options) => new TilePanel(options.id, options.name),
    });

    // Restore saved layout, else build a default
    const saved = doc()?.layout;
    if (saved && saved.grid?.root?.data) {
      try {
        suppressSave = true;
        gridview.fromJSON(saved);
        suppressSave = false;
      } catch (err) {
        console.warn(LOG, "fromJSON failed, building default", err);
        suppressSave = false;
        gridview.clear();
        buildDefault();
      }
    } else {
      buildDefault();
    }

    // Persist on any layout change (resize/move/add/remove)
    const sub = gridview.onDidLayoutChange(() => saveLayout());

    // Route patchwork:open-document to the main panel
    const onOpenDoc = (e: Event) => {
      const evt = e as CustomEvent<{ url: string; toolId?: string }>;
      evt.stopPropagation();
      const { url, toolId } = evt.detail ?? {};
      if (!url || !gridview) return;
      const main = mainTileId() && gridview.getPanel(mainTileId()) ? mainTileId() : gridview.panels[0]?.id;
      if (!main) return;
      const nextToolId = toolId ? String(toolId) : "";
      const cur = contentSig()[main];
      if (cur && cur.docUrl === url && cur.toolId === nextToolId) return;
      console.log(LOG, "open-document → panel", main, { url, toolId: nextToolId || "(default)" });
      writeContent({ ...contentSig(), [main]: { docUrl: url, toolId: nextToolId } });
    };
    props.element.addEventListener("patchwork:open-document", onOpenDoc);

    document.addEventListener("mousemove", onDocMove);
    document.addEventListener("mouseup", onDocUp);

    onCleanup(() => {
      sub.dispose();
      props.element.removeEventListener("patchwork:open-document", onOpenDoc);
      document.removeEventListener("mousemove", onDocMove);
      document.removeEventListener("mouseup", onDocUp);
      gridview?.dispose();
      gridview = undefined;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    });
  });

  return (
    <div class="tiles-frame dockview-theme-light">
      <div ref={containerRef} class="tiles-grid" />
      <LayoutButton onApplyPreset={applyPreset} />
    </div>
  );
}
