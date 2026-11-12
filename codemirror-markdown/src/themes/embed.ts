import { EditorView } from "@codemirror/view";

// Outer container only; all embed chrome lives in the shared "embed" tool.
export const embedTheme = EditorView.baseTheme({
  ".cm-embed": {
    display: "block",
    border: "var(--studio-border-width, 1px) var(--studio-border-style, solid)",
    borderRadius: "4px",
    overflow: "hidden",
  },
  "&light .cm-embed": {
    borderColor: "#ddd",
  },
  "&dark .cm-embed": {
    borderColor: "#333",
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
