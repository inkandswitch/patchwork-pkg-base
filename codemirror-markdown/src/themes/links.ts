import { EditorView } from "@codemirror/view";

export const linkTheme = EditorView.baseTheme({
  ".cm-link": {
    textDecoration: "underline",
    cursor: "var(--studio-cursor-pointer, pointer)",
    // the widget replaces the link's text, so the theme's `t.link` highlight
    // (theming/src/codemirror-theme.ts) never reaches it: read the same tokens.
    fontFamily: "var(--markdown-body-family, var(--text-editor-family-sans))",
    color: "var(--syntax-link, #0066cc)",
    backgroundColor: "var(--syntax-fill-link)",
    fontStyle: "var(--syntax-style-link)",
    fontWeight: "var(--syntax-weight-link)",
    "&:hover": {
      color: "inherit",
    },
  },
  ".cm-md-link-hover, .cm-md-link-hover *": {
    textDecoration: "underline",
    cursor: "var(--studio-cursor-pointer, pointer)",
  },
});
