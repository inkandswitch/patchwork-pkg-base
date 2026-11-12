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
  ".cm-embed > patchwork-view": {
    display: "block",
    height: "500px",
    width: "100%",
  },
});
