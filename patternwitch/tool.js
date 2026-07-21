import {
  MIN_SIZE,
  MAX_SIZE,
  MIN_COLORS,
  MAX_COLORS,
  makePixels,
} from "./datatype.js";

// ============================================================================
// Styles
// ============================================================================

const STYLES = `
@layer package {
  :root, :host, [theme] {
    --pw-bg: var(--editor-fill, #fff);
    --pw-fg: var(--editor-line, #1a1a1a);
    --pw-muted: var(--editor-line-offset-50, #888);
    --pw-panel: color-mix(in oklch, var(--editor-fill), var(--editor-line) 4%);
    --pw-border: var(--editor-fill-offset-20, #ddd);
    --pw-hover: color-mix(in oklch, var(--editor-fill), var(--editor-line) 8%);
    --pw-accent: var(--studio-primary, #35f7ca);
    --pw-accent-soft: color-mix(in oklch, var(--studio-primary, #35f7ca), var(--editor-fill) 78%);
    --pw-danger: var(--studio-danger, #e5484d);
    --pw-grid-line: color-mix(in oklch, var(--editor-line), transparent 88%);
    --pw-scrim: color-mix(in oklch, var(--editor-line), transparent 60%);
    --pw-family: var(--editor-family-sans, system-ui, sans-serif);
    --pw-family-code: var(--editor-family-code, ui-monospace, monospace);
    --pw-shadow: var(--studio-shadow-lg, 0 8px 32px rgba(0,0,0,.18));
    --pw-shadow-sm: var(--studio-shadow-sm, 0 1px 4px rgba(0,0,0,.2));
  }
}

.patternwitch {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--pw-bg);
  color: var(--pw-fg);
  font-family: var(--pw-family);
  box-sizing: border-box;
  overflow: hidden;
  user-select: none;
}
.patternwitch * { box-sizing: border-box; }

/* Toolbar */
.patternwitch .toolbar {
  display: flex;
  align-items: center;
  gap: var(--studio-space-2xs, 4px);
  padding: var(--studio-space-xs, 8px) var(--studio-space-sm, 12px);
  border-bottom: 1px solid var(--pw-border);
}
.patternwitch .tool-group {
  display: flex;
  align-items: center;
  gap: var(--studio-space-2xs, 4px);
}
.patternwitch .spacer { flex: 1; }

.patternwitch .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  min-width: 34px;
  padding: 0 10px;
  border: 1px solid var(--pw-border);
  border-radius: var(--studio-radius-sm, 6px);
  background: var(--pw-bg);
  color: var(--pw-fg);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--studio-transition-fast, .1s ease),
              border-color var(--studio-transition-fast, .1s ease);
}
.patternwitch .btn:hover { background: var(--pw-hover); }
.patternwitch .btn svg { width: 17px; height: 17px; display: block; }
.patternwitch .btn[data-active] {
  border-color: var(--pw-accent);
  background: var(--pw-accent-soft);
}
.patternwitch .btn[data-danger]:hover {
  border-color: var(--pw-danger);
  color: var(--pw-danger);
}
.patternwitch .btn:disabled {
  opacity: .4;
  cursor: default;
}

/* Palette strip */
.patternwitch .palette {
  display: flex;
  align-items: center;
  gap: var(--studio-space-2xs, 6px);
  padding: var(--studio-space-xs, 8px) var(--studio-space-sm, 12px);
  border-bottom: 1px solid var(--pw-border);
  flex-wrap: wrap;
}
.patternwitch .swatch {
  width: 30px;
  height: 30px;
  border-radius: var(--studio-radius-round, 9999px);
  border: 2px solid var(--pw-border);
  cursor: pointer;
  padding: 0;
  transition: transform var(--studio-transition-fast, .1s ease);
  position: relative;
}
.patternwitch .swatch:hover { transform: scale(1.08); }
.patternwitch .swatch[data-active] {
  border-color: var(--pw-fg);
  box-shadow: 0 0 0 2px var(--pw-bg), 0 0 0 4px var(--pw-accent);
}

/* Canvas stage */
.patternwitch .stage {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  overflow: hidden;
  background:
    repeating-conic-gradient(var(--pw-panel) 0% 25%, transparent 0% 50%)
    0 0 / 20px 20px;
}
.patternwitch .canvas-wrap {
  position: relative;
  box-shadow: var(--pw-shadow);
  line-height: 0;
}
.patternwitch canvas {
  display: block;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  touch-action: none;
  cursor: crosshair;
}
.patternwitch .grid-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, var(--pw-grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--pw-grid-line) 1px, transparent 1px);
  opacity: 0;
  transition: opacity var(--studio-transition-fast, .1s ease);
}
.patternwitch .grid-overlay[data-show] { opacity: 1; }

/* Resize grip, bottom-right */
.patternwitch .grip {
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 18px;
  height: 18px;
  border-radius: var(--studio-radius-round, 9999px);
  background: var(--pw-bg);
  border: 2px solid var(--pw-accent);
  cursor: nwse-resize;
  box-shadow: var(--pw-shadow-sm);
}
.patternwitch .grip:hover { background: var(--pw-accent); }

.patternwitch .caption {
  position: absolute;
  left: 14px;
  bottom: 8px;
  font-size: 11px;
  letter-spacing: .04em;
  color: var(--pw-muted);
  text-transform: uppercase;
}

/* Settings modal */
.patternwitch .modal-backdrop {
  position: absolute;
  inset: 0;
  background: var(--pw-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.patternwitch .modal {
  width: min(380px, 90%);
  max-height: 90%;
  overflow: auto;
  background: var(--pw-bg);
  border: 1px solid var(--pw-border);
  border-radius: var(--studio-radius-lg, 12px);
  box-shadow: var(--pw-shadow);
  padding: var(--studio-space-md, 18px);
}
.patternwitch .modal h2 {
  margin: 0 0 var(--studio-space-sm, 12px);
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.patternwitch .modal h2 svg {
  width: 18px;
  height: 18px;
  flex: none;
}
.patternwitch .modal .section-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--pw-muted);
  margin: var(--studio-space-md, 18px) 0 var(--studio-space-2xs, 6px);
}
.patternwitch .palette-editor {
  display: flex;
  flex-direction: column;
  gap: var(--studio-space-2xs, 6px);
}
.patternwitch .palette-row {
  display: flex;
  align-items: center;
  gap: var(--studio-space-xs, 8px);
}
.patternwitch .palette-row input[type="color"] {
  width: 42px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--pw-border);
  border-radius: var(--studio-radius-sm, 6px);
  background: none;
  cursor: pointer;
}
.patternwitch .palette-row .hex {
  flex: 1;
  font-family: var(--pw-family-code);
  font-size: 13px;
  color: var(--pw-muted);
}
.patternwitch .add-color { margin-top: var(--studio-space-xs, 8px); }
.patternwitch .size-row {
  display: flex;
  align-items: center;
  gap: var(--studio-space-sm, 12px);
}
.patternwitch .size-row label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.patternwitch .size-row input[type="number"] {
  width: 68px;
  height: 34px;
  padding: 0 8px;
  border: 1px solid var(--pw-border);
  border-radius: var(--studio-radius-sm, 6px);
  background: var(--pw-bg);
  color: var(--pw-fg);
  font: inherit;
}
.patternwitch .modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--studio-space-2xs, 6px);
  margin-top: var(--studio-space-md, 18px);
}
`;

// ============================================================================
// Icons (inline lucide-style SVG)
// ============================================================================

const ICONS = {
  pencil: `<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
  fill: `<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>`,
  undo: `<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>`,
  trash: `<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  cog: `<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>`,
  plus: `<path d="M12 5v14"/><path d="M5 12h14"/>`,
  x: `<path d="M18 6 6 18"/><path d="M6 6l12 12"/>`,
  grid: `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>`,
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

// ============================================================================
// Tool
// ============================================================================

export default function PatternWitchTool(handle, element) {
  const root = document.createElement("div");
  root.className = "patternwitch";
  const style = document.createElement("style");
  style.textContent = STYLES;
  element.append(style, root);

  // ---- local UI state ----
  let activeColor = 0;
  let activeTool = "draw"; // "draw" | "fill"
  let showSettings = false;
  const history = []; // stack of pixel snapshots for undo (local)
  const HISTORY_MAX = 40;

  // ---- helpers ----
  const getDoc = () => handle.doc();
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const snapshot = () => getDoc().pixels.map((row) => row.slice());

  function pushHistory(pixels = snapshot()) {
    history.push(pixels);
    if (history.length > HISTORY_MAX) history.shift();
  }

  // Write a whole grid cell by cell, so concurrent edits from peers merge
  // instead of fighting over replaced rows.
  function writePixels(next) {
    handle.change((d) => {
      if (d.height !== next.length || d.width !== next[0].length) {
        d.height = next.length;
        d.width = next[0].length;
        d.pixels = next;
        return;
      }
      for (let y = 0; y < d.height; y++)
        for (let x = 0; x < d.width; x++)
          if (d.pixels[y][x] !== next[y][x]) d.pixels[y][x] = next[y][x];
    });
  }

  // Resize the grid, preserving overlapping pixels.
  function resize(newW, newH, record = true) {
    newW = clamp(Math.round(newW), MIN_SIZE, MAX_SIZE);
    newH = clamp(Math.round(newH), MIN_SIZE, MAX_SIZE);
    const doc = getDoc();
    if (newW === doc.width && newH === doc.height) return;
    if (record) pushHistory();
    const old = doc.pixels;
    const next = makePixels(newW, newH, 0);
    for (let y = 0; y < Math.min(newH, doc.height); y++)
      for (let x = 0; x < Math.min(newW, doc.width); x++)
        next[y][x] = old[y][x];
    handle.change((d) => {
      d.width = newW;
      d.height = newH;
      d.pixels = next;
    });
  }

  function floodFill(sx, sy, target) {
    const doc = getDoc();
    const { width, height } = doc;
    const from = doc.pixels[sy][sx];
    if (from === target) return;
    const before = snapshot();
    const grid = snapshot();
    const stack = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (grid[y][x] !== from) continue;
      grid[y][x] = target;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    pushHistory(before);
    writePixels(grid);
  }

  function undo() {
    if (!history.length) return;
    writePixels(history.pop());
  }

  function clearAll() {
    const doc = getDoc();
    pushHistory();
    writePixels(makePixels(doc.width, doc.height, activeColor));
  }

  // ============================================================
  // Static UI skeleton (built once)
  // ============================================================
  root.innerHTML = `
    <div class="toolbar">
      <div class="tool-group">
        <button class="btn" data-tool="draw" title="Draw">${icon("pencil")}</button>
        <button class="btn" data-tool="fill" title="Fill">${icon("fill")}</button>
      </div>
      <div class="tool-group">
        <button class="btn" data-act="undo" title="Undo">${icon("undo")}</button>
        <button class="btn" data-act="clear" data-danger title="Clear all">${icon("trash")}</button>
      </div>
      <div class="spacer"></div>
      <button class="btn" data-act="settings" title="Settings">${icon("cog")}</button>
    </div>
    <div class="palette"></div>
    <div class="stage">
      <div class="canvas-wrap">
        <canvas></canvas>
        <div class="grid-overlay"></div>
        <div class="grip" title="Drag to resize canvas"></div>
      </div>
      <div class="caption"></div>
    </div>
    <div class="modal-mount"></div>
  `;

  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const stage = root.querySelector(".stage");
  const gridOverlay = root.querySelector(".grid-overlay");
  const paletteEl = root.querySelector(".palette");
  const captionEl = root.querySelector(".caption");
  const grip = root.querySelector(".grip");
  const modalMount = root.querySelector(".modal-mount");

  // ============================================================
  // Rendering
  // ============================================================
  function paintPixel(x, y, color) {
    const { palette } = getDoc();
    ctx.fillStyle = palette[color] || palette[0];
    ctx.fillRect(x, y, 1, 1);
  }

  function drawCanvas() {
    const doc = getDoc();
    const { width, height, pixels } = doc;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) paintPixel(x, y, pixels[y][x]);
    // A change landing mid-stroke must not erase what isn't committed yet.
    if (strokeCells)
      for (const [k, color] of strokeCells) {
        const [x, y] = k.split(",");
        paintPixel(Number(x), Number(y), color);
      }
    layout();
  }

  // Fit the canvas display size into the stage, keeping square cells.
  function layout() {
    const { width, height } = getDoc();
    const pad = 56;
    const availW = Math.max(40, stage.clientWidth - pad);
    const availH = Math.max(40, stage.clientHeight - pad);
    const cell = Math.max(
      1,
      Math.floor(Math.min(availW / width, availH / height)),
    );
    canvas.style.width = cell * width + "px";
    canvas.style.height = cell * height + "px";
    gridOverlay.style.backgroundSize = `${cell}px ${cell}px`;
    gridOverlay.toggleAttribute("data-show", cell >= 6);
    captionEl.textContent = `${width} × ${height} px`;
  }

  function renderPalette() {
    const { palette } = getDoc();
    if (activeColor >= palette.length) activeColor = 0;
    paletteEl.innerHTML = "";
    palette.forEach((hex, i) => {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.background = hex;
      b.title = `Colour ${i + 1} (${hex})`;
      if (i === activeColor) b.setAttribute("data-active", "");
      b.addEventListener("click", () => {
        activeColor = i;
        renderPalette();
      });
      paletteEl.append(b);
    });
  }

  function renderToolbar() {
    root.querySelectorAll("[data-tool]").forEach((el) => {
      el.toggleAttribute("data-active", el.dataset.tool === activeTool);
    });
  }

  // ============================================================
  // Painting interaction
  // ============================================================

  // Cell under the pointer. Clamped to the grid so a drag that leaves the
  // canvas keeps tracking the edge instead of jumping on re-entry.
  function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const { width, height } = getDoc();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * height);
    return {
      x: clamp(x, 0, width - 1),
      y: clamp(y, 0, height - 1),
      inside: x >= 0 && y >= 0 && x < width && y < height,
    };
  }

  let painting = false;
  let strokeCells = null; // Map<"x,y", colour> of pending changes
  let lastCell = null; // last painted cell in the current stroke
  let strokeBefore = null; // pixels as they were when the stroke started

  function paintCell(x, y) {
    const k = `${x},${y}`;
    const current = strokeCells.has(k) ? strokeCells.get(k) : getDoc().pixels[y][x];
    if (current === activeColor) return;
    strokeCells.set(k, activeColor);
    paintPixel(x, y, activeColor);
  }

  // Paint a continuous line so fast drags leave no gaps (shapes stay sealed).
  function paintLine(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    while (true) {
      paintCell(x, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  // Commit cell by cell: replacing whole rows makes concurrent edits merge as
  // list insertions, which shifts pixels sideways and duplicates them.
  function commitStroke() {
    const cells = strokeCells;
    const before = strokeBefore;
    strokeCells = null;
    strokeBefore = null;
    if (!cells || cells.size === 0) return;
    pushHistory(before);
    handle.change((d) => {
      for (const [k, color] of cells) {
        const [x, y] = k.split(",").map(Number);
        if (y < d.height && x < d.width) d.pixels[y][x] = color;
      }
    });
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (painting) return;
    const c = cellFromEvent(e);
    if (!c.inside) return;
    if (activeTool === "fill") {
      floodFill(c.x, c.y, activeColor);
      return;
    }
    painting = true;
    strokeCells = new Map();
    strokeBefore = snapshot();
    canvas.setPointerCapture(e.pointerId);
    paintCell(c.x, c.y);
    lastCell = c;
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!painting) return;
    const c = cellFromEvent(e);
    if (lastCell) paintLine(lastCell.x, lastCell.y, c.x, c.y);
    else paintCell(c.x, c.y);
    lastCell = c;
  });

  function endStroke(e) {
    if (!painting) return;
    painting = false;
    lastCell = null;
    if (e && canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
    commitStroke();
  }
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);

  // ============================================================
  // Toolbar / actions
  // ============================================================
  root.querySelectorAll("[data-tool]").forEach((el) => {
    el.addEventListener("click", () => {
      activeTool = el.dataset.tool;
      renderToolbar();
    });
  });
  root.querySelector('[data-act="undo"]').addEventListener("click", undo);
  root.querySelector('[data-act="clear"]').addEventListener("click", clearAll);
  root.querySelector('[data-act="settings"]').addEventListener("click", () => {
    showSettings = true;
    renderModal();
  });

  // ============================================================
  // Resize grip (bottom-right)
  // ============================================================
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const doc = getDoc();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = doc.width;
    const startH = doc.height;
    const rect = canvas.getBoundingClientRect();
    const step = Math.max(4, rect.width / doc.width); // px per cell
    grip.setPointerCapture(e.pointerId);
    pushHistory(); // one undo entry for the whole drag

    const onMove = (ev) => {
      const dW = Math.round((ev.clientX - startX) / step);
      const dH = Math.round((ev.clientY - startY) / step);
      resize(startW + dW, startH + dH, false);
    };
    const onUp = (ev) => {
      grip.releasePointerCapture(ev.pointerId);
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
  });

  // ============================================================
  // Settings modal
  // ============================================================
  function renderModal() {
    modalMount.innerHTML = "";
    if (!showSettings) return;
    const doc = getDoc();

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.addEventListener("pointerdown", (e) => {
      if (e.target === backdrop) {
        showSettings = false;
        renderModal();
      }
    });

    const paletteRows = doc.palette
      .map(
        (hex, i) => `
      <div class="palette-row" data-i="${i}">
        <input type="color" value="${hex}" />
        <span class="hex">${hex}</span>
        <button class="btn" data-remove data-danger title="Remove colour"
          ${doc.palette.length <= MIN_COLORS ? "disabled" : ""}>
          ${icon("x")}
        </button>
      </div>`,
      )
      .join("");

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h2>${icon("cog")} Settings</h2>

      <div class="section-label">Palette (${doc.palette.length}/${MAX_COLORS})</div>
      <div class="palette-editor">${paletteRows}</div>
      <button class="btn add-color" data-add
        ${doc.palette.length >= MAX_COLORS ? "disabled" : ""}>
        ${icon("plus")} Add colour
      </button>

      <div class="section-label">Canvas size</div>
      <div class="size-row">
        <label>W <input type="number" data-dim="w" min="${MIN_SIZE}" max="${MAX_SIZE}" value="${doc.width}"/></label>
        <label>H <input type="number" data-dim="h" min="${MIN_SIZE}" max="${MAX_SIZE}" value="${doc.height}"/></label>
        <button class="btn" data-apply-size>${icon("grid")} Apply</button>
      </div>

      <div class="modal-actions">
        <button class="btn" data-close>Done</button>
      </div>
    `;

    modal.querySelectorAll(".palette-row").forEach((rowEl) => {
      const i = Number(rowEl.dataset.i);
      const input = rowEl.querySelector('input[type="color"]');
      const hexLabel = rowEl.querySelector(".hex");
      input.addEventListener("input", () => {
        hexLabel.textContent = input.value;
        handle.change((d) => {
          d.palette[i] = input.value;
        });
      });
      rowEl.querySelector("[data-remove]").addEventListener("click", () => {
        if (getDoc().palette.length <= MIN_COLORS) return;
        removeColor(i);
        renderModal();
      });
    });

    modal.querySelector("[data-add]").addEventListener("click", () => {
      if (getDoc().palette.length >= MAX_COLORS) return;
      handle.change((d) => {
        d.palette.push("#000000");
      });
      renderModal();
    });

    modal.querySelector("[data-apply-size]").addEventListener("click", () => {
      resize(
        Number(modal.querySelector('[data-dim="w"]').value),
        Number(modal.querySelector('[data-dim="h"]').value),
      );
    });

    modal.querySelector("[data-close]").addEventListener("click", () => {
      showSettings = false;
      renderModal();
    });

    backdrop.append(modal);
    modalMount.append(backdrop);
  }

  // Remove a palette colour and remap pixels that referenced it.
  function removeColor(index) {
    pushHistory();
    handle.change((d) => {
      d.palette.splice(index, 1);
      const max = d.palette.length - 1;
      for (let y = 0; y < d.height; y++)
        for (let x = 0; x < d.width; x++) {
          let v = d.pixels[y][x];
          if (v === index) v = 0;
          else if (v > index) v = v - 1;
          v = clamp(v, 0, max);
          if (d.pixels[y][x] !== v) d.pixels[y][x] = v;
        }
    });
  }

  // ============================================================
  // Sync
  // ============================================================
  function render() {
    drawCanvas();
    renderPalette();
    renderToolbar();
    renderModal();
  }
  render();

  const onChange = () => {
    drawCanvas();
    renderPalette();
    if (showSettings) renderModal();
  };
  handle.on("change", onChange);

  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);

  return () => {
    handle.off("change", onChange);
    ro.disconnect();
    root.remove();
    style.remove();
  };
}
