import { EditorView } from "@codemirror/view";

// Outer container only; all embed chrome lives in the shared "embed" tool.
export const embedTheme = EditorView.baseTheme({
  // The frame's border only shows once you've clicked into the embed; until
  // then it sits in the text like the rest of the document.
  ".cm-embed": {
    display: "block",
    border: "var(--studio-border-width, 1px) var(--studio-border-style, solid) transparent",
    borderRadius: "4px",
    overflow: "hidden",
    outline: "none",
    transition:
      "border-color max(1ms, calc(150ms * var(--studio-motion-scale, 1) * var(--studio-motion-preference, 1)))",
  },
  "&light .cm-embed:focus-within": {
    borderColor: "var(--text-editor-fill-offset-30, #ddd)",
  },
  "&dark .cm-embed:focus-within": {
    borderColor: "var(--text-editor-fill-offset-30, #333)",
  },
  // Images are just images: no border, natural size, never wider than the text.
  "&light .cm-embed.cm-embed-image, &dark .cm-embed.cm-embed-image": {
    border: "none",
    borderRadius: "0",
  },
  ".cm-embed-image > img": {
    display: "block",
    maxWidth: "100%",
    height: "auto",
  },
  // a frame: resizable from its corner (extensions/embed.ts), never wider
  // than the text
  ".cm-embed.cm-embed-frame": {
    position: "relative",
    maxWidth: "100%",
    boxSizing: "border-box",
  },
  // the handle shows on hover or focus, a small corner like a textarea's
  ".cm-embed-resize": {
    position: "absolute",
    right: "0",
    bottom: "0",
    width: "16px",
    height: "16px",
    cursor: "nwse-resize",
    touchAction: "none",
    opacity: "0",
    transition:
      "opacity max(1ms, calc(150ms * var(--studio-motion-scale, 1) * var(--studio-motion-preference, 1)))",
  },
  ".cm-embed-resize::before": {
    content: '""',
    position: "absolute",
    right: "3px",
    bottom: "3px",
    width: "7px",
    height: "7px",
    borderRight: "2px solid var(--text-editor-line-offset-40, #999)",
    borderBottom: "2px solid var(--text-editor-line-offset-40, #999)",
    borderRadius: "0 0 2px 0",
  },
  ".cm-embed:hover > .cm-embed-resize, .cm-embed:focus-within > .cm-embed-resize, .cm-embed-resizing > .cm-embed-resize":
    {
      opacity: "1",
    },
  ".cm-embed-resizing": {
    userSelect: "none",
  },
  ".cm-embed > patchwork-view": {
    display: "block",
    height: "500px",
    width: "100%",
  },
});
