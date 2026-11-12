import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * Cmd+= / Cmd+- / Cmd+0 (Ctrl off a Mac) resize the editor's text instead of
 * zooming the whole page — same steps as the `file` tool's editor.
 *
 * Alongside the font size this sets `--markdown-zoom` (new size / base size)
 * on the editor, because the markdown theme lays out line heights, padding
 * and heading margins in `rem`, which wouldn't follow the font. The theme
 * multiplies those by the factor (see `zoomed` in themes/markdown.ts).
 */
const MIN_FONT_SIZE = 6;
const FALLBACK_FONT_SIZE = 16;

const px = (value: string) => parseFloat(value) || FALLBACK_FONT_SIZE;

/** The editor's font size with no zoom applied. */
function baseSize(view: EditorView): number {
  const { style } = view.dom;
  const zoomed = style.fontSize;
  style.fontSize = "";
  const base = px(getComputedStyle(view.dom).fontSize);
  style.fontSize = zoomed;
  return base;
}

function step(view: EditorView, by: number): boolean {
  const { style } = view.dom;
  if (by === 0) {
    style.fontSize = "";
    style.removeProperty("--markdown-zoom");
  } else {
    const current = px(getComputedStyle(view.dom).fontSize);
    const size = Math.max(MIN_FONT_SIZE, current + by);
    style.fontSize = `${size}px`;
    style.setProperty("--markdown-zoom", String(size / baseSize(view)));
  }
  view.requestMeasure();
  return true;
}

export const zoomIn = (view: EditorView) => step(view, 1);
export const zoomOut = (view: EditorView) => step(view, -1);
export const zoomReset = (view: EditorView) => step(view, 0);

export const markdownZoom = Prec.high(
  keymap.of([
    // `+` and `_` are the shifted keys, for keyboards that need Shift.
    { key: "Mod-=", run: zoomIn, preventDefault: true },
    { key: "Mod-+", run: zoomIn, preventDefault: true },
    { key: "Mod--", run: zoomOut, preventDefault: true },
    { key: "Mod-_", run: zoomOut, preventDefault: true },
    { key: "Mod-0", run: zoomReset, preventDefault: true },
  ])
);
