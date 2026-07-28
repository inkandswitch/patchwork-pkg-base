import { EditorView } from "@codemirror/view";

// Only the outer container: all embed chrome (title bar, tool picker, open
// button) lives in the shared "embed" tool mounted via <patchwork-view>.
export const embedTheme = EditorView.baseTheme({
  ".cm-embed": {
    display: "block",
    border: "1px solid",
    borderRadius: "4px",
    overflow: "hidden",
  },
  "&light .cm-embed": {
    borderColor: "#ddd",
  },
  "&dark .cm-embed": {
    borderColor: "#333",
  },
  ".cm-embed > patchwork-view": {
    display: "block",
    height: "500px",
    width: "100%",
  },
});
