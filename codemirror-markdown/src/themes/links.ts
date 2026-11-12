import { EditorView } from "@codemirror/view";

export const linkTheme = EditorView.baseTheme({
  ".cm-link": {
    textDecoration: "underline",
    // a plain click edits; it's a pointer only while Mod is held (below).
    // the widget replaces the link's text, so the theme's `t.link` highlight
    // (theming/src/codemirror-theme.ts) never reaches it: read the same tokens.
    fontFamily: "var(--markdown-body-family, var(--text-editor-family-sans))",
    color: "var(--syntax-link, #0066cc)",
    backgroundColor: "var(--syntax-fill-link)",
    // weight and style come from where the link sits — a heading, bold or
    // italic text — so they're inherited, not set (see the rules below)
    "&:hover": {
      color: "inherit",
    },
  },
  // in a heading, the heading's own font (its line class sets it)
  ".cm-md-h1 .cm-link, .cm-md-h2 .cm-link, .cm-md-h3 .cm-link, .cm-md-h4 .cm-link, .cm-md-h5 .cm-link, .cm-md-h6 .cm-link":
    {
      fontFamily: "inherit",
    },
  // the inline styling the link sits in (links.ts: inheritedStyle)
  ".cm-link.cm-md-strong": {
    fontWeight: "var(--syntax-weight-strong, bold)",
  },
  ".cm-link.cm-md-em": {
    fontStyle: "var(--syntax-style-emphasis, italic)",
  },
  ".cm-link.cm-md-strike": {
    textDecoration: "underline line-through",
  },
  ".cm-md-link-hover, .cm-md-link-hover *": {
    textDecoration: "underline",
    cursor: "var(--studio-cursor-pointer, pointer)",
  },
});
