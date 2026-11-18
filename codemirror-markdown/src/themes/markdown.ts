import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { Tag, tags } from "@lezer/highlight";

/**
 * A url written on its own (not inside link syntax). A kind of `tags.link`, so
 * the theme's link colour reaches it; its own rule here lets it wrap mid-url.
 */
export const bareUrl = Tag.define(tags.link);

/**
 * Urls break anywhere. Otherwise a url too long for the line jumps down to a
 * line of its own first — leaving a list item's bullet alone on the line
 * above — and only then breaks.
 */
const breakUrl = { wordBreak: "break-all" };

const bodyFont = (style: "serif" | "sans") =>
  style == "serif"
    ? 'var(--text-editor-family-serif, "Merriweather", serif)'
    : "var(--text-editor-family-sans)";

/**
 * Scale a fixed length by the editor's text zoom (`--markdown-zoom`, set by
 * extensions/zoom.ts). `em`/`ex` lengths follow the font already; `rem` and
 * `px` ones need this or they'd stay put while the text grows.
 */
const zoomed = (length: string) => `calc(${length} * var(--markdown-zoom, 1))`;

const markdownStyles = (style: "serif" | "sans"): Record<string, any> => ({
  "&": {},
  "&.cm-editor.cm-focused": {
    outline: "none",
  },

  "&.cm-editor": {
    height: "100%",
    display: "flex",
    alignContent: "center",
    justifyContent: "center",
    overflow: "auto",
  },
  ".cm-scroller": {
    background: "var(--text-editor-fill)",
  },
  ".cm-gutter": {
    background: "transparent",
  },
  ".cm-content": {
    // for things outside the highlighter (the link widget) to match the text.
    "--markdown-body-family": bodyFont(style),
    // Justified text makes it look more like the I&S web essay template,
    // but doesn't feel right for most documents.
    // textAlign: "justify",
    textWrap: "pretty",
    fontFamily: bodyFont(style),
    lineHeight: zoomed("1.5rem"),
    color: "var(--text-editor-line)",
    caretColor: "var(--text-editor-cursor-fill)",
    background: "var(--text-editor-fill)",
    marginBlock: zoomed("2rem"),
    marginInline: "auto",
    // lol i guess this is the same as box-sizing: content-box
    maxWidth: `calc(var(--max-text-line-width, 100ex) - ${zoomed("2rem")})`,
    padding: zoomed("2rem"),
    // room for the markers hung in the margin (extensions/margin.ts).
    paddingLeft: `calc(${zoomed("2rem")} + var(--markdown-hang, 0px))`,
    boxShadow: "none",
    marginBottom: "8em",
    borderRadius: "8px",
  },
  ".cm-content li": {
    marginBottom: 0,
  },
  ".cm-task-done": {
    opacity: 0.6,
  },
  ".cm-activeLine": {
    backgroundColor: "inherit",
  },

  ".frontmatter, .frontmatter *": {
    fontSize: zoomed("14px"),
    fontFamily: "var(--text-editor-family-code)",
    color: "var(--syntax-comment, #666)",
    textDecoration: "none",
    fontWeight: "normal",
    lineHeight: "0.8em",
  },

  ".cm-gutters": {
    borderRight: "0",
    border: "0",
    background: "var(--text-editor-gutter-fill)",
  },

  ".cm-comment-gutter": {
    width: "20px",
  },

  ".cm-folded-range-gutter-line-number": {
    display: "none",
  },

  ".cm-folded-range-gutter": {
    background: "var(--text-editor-fill)",
    borderRight: "0px",
    width: "40px",
  },

  ".cm-folded-line-widget": {
    background: "var(--text-editor-fill)",
    border: "0px",
  },

  ".cm-folded-range": {
    background: "var(--text-editor-fill)",
  },
});

const baseHeadingStyles = {
  fontFamily: "var(--studio-heading-family, var(--text-editor-family-sans))",
  textDecoration: "none",
};

/** Bulma's title/subtitle pair: h1 is the one title, heavy and tight; h2–h6
 *  are subtitles, stepping down in size with only a little weight, and a
 *  touch softer in colour. A theme can still set them
 *  (--studio-heading-weight-1 for h1, --studio-heading-weight for the rest). */
const H1_WEIGHT = "var(--studio-heading-weight-1, 800)";
const HEADING_WEIGHT = "var(--studio-heading-weight, 500)";
const SUBTITLE_COLOUR =
  "color-mix(in oklab, var(--text-editor-line) 82%, var(--text-editor-fill, transparent))";

type HeadingSize = {
  fontSize: string;
  lineHeight: string;
  fontWeight: string;
  letterSpacing?: string;
  color?: string;
};

const subtitle = (level: number, size: string, leading: string): HeadingSize => ({
  fontSize: `var(--studio-heading-size-${level}, ${zoomed(size)})`,
  lineHeight: zoomed(leading),
  fontWeight: HEADING_WEIGHT,
  color: SUBTITLE_COLOUR,
});

/** Size and leading per heading level, shared by the highlight rules (the
 *  heading's text) and the line classes margin.ts puts on heading lines.
 *  Bulma's 3 / 2.5 / 2 / 1.5 / 1.25 / 1rem, pulled in a little for a page
 *  you write on rather than a landing page. */
const headingSizes: Record<number, HeadingSize> = {
  1: {
    fontSize: `var(--studio-heading-size-1, ${zoomed("2.25rem")})`,
    lineHeight: zoomed("2.75rem"),
    fontWeight: H1_WEIGHT,
    letterSpacing: "-0.02em",
  },
  2: subtitle(2, "1.75rem", "2.25rem"),
  3: subtitle(3, "1.5rem", "2rem"),
  4: subtitle(4, "1.25rem", "1.75rem"),
  5: subtitle(5, "1.125rem", "1.5rem"),
  6: subtitle(6, "1rem", "1.5rem"),
};

/**
 * The same, on the whole line: a widget that replaces part of a heading (a
 * rendered link) isn't wrapped in the heading's highlight span, so without
 * this it falls back to the body size.
 */
const headingLines = {
  ...Object.fromEntries(
    Object.entries(headingSizes).map(([level, size]) => [
      `.cm-md-h${level}`,
      {
        fontFamily: baseHeadingStyles.fontFamily,
        ...size,
        // the patchwork theme's highlighter weights and colours headings by
        // these; match. headings are set off by size, not by the theme's
        // code colour for headings: the title is the text colour, subtitles
        // a touch softer.
        "--syntax-weight-heading": size.fontWeight,
        "--syntax-heading": size.color ?? "var(--text-editor-line)",
      },
    ])
  ),
};

const baseCodeStyles = {
  fontFamily: "var(--text-editor-family-code)",
  fontSize: "1em",
};

export const markdownSyntaxHighlighting = (style: "serif" | "sans") =>
  HighlightStyle.define([
    // this is how you ensure that codeblocks are still monospace.
    // a node's own class *replaces* its parent's in the highlighter, so text
    // inside **bold**, *italic* and ~~struck~~ loses this one and falls back to
    // `.cm-content`, which the patchwork theme sets to the code font. those
    // rules set the body font again; inline code inside them still wins,
    // being later in this list.
    {
      tag: tags.content,
      fontFamily: bodyFont(style),
    },
    {
      tag: tags.heading1,
      ...baseHeadingStyles,
      ...headingSizes[1],
      marginBottom: zoomed("1rem"),
      marginTop: zoomed("2rem"),
    },
    {
      tag: tags.heading2,
      ...baseHeadingStyles,
      ...headingSizes[2],
      marginBottom: zoomed("1rem"),
      marginTop: zoomed("2rem"),
    },
    {
      tag: tags.heading3,
      ...baseHeadingStyles,
      ...headingSizes[3],
      marginBottom: zoomed("1rem"),
      marginTop: zoomed("2rem"),
    },
    {
      tag: tags.heading4,
      ...baseHeadingStyles,
      ...headingSizes[4],
      marginBottom: zoomed("1rem"),
      marginTop: zoomed("2rem"),
    },
    {
      tag: tags.heading5,
      ...baseHeadingStyles,
      ...headingSizes[5],
    },
    {
      tag: tags.heading6,
      ...baseHeadingStyles,
      ...headingSizes[6],
    },
    {
      tag: tags.processingInstruction,
      color: "var(--text-editor-line-offset-40)",
    },
    {
      tag: tags.comment,
      color: "var(--syntax-comment, #555)",
      fontFamily: "var(--text-editor-family-code)",
    },
    // quotes are set off by their bar (margin.ts), not by italics.
    {
      tag: tags.strong,
      fontFamily: bodyFont(style),
      fontWeight: "var(--syntax-weight-strong, bold)",
    },
    {
      tag: tags.emphasis,
      fontFamily: bodyFont(style),
      fontStyle: "var(--syntax-style-emphasis, italic)",
    },
    {
      tag: tags.strikethrough,
      fontFamily: bodyFont(style),
      textDecoration: "line-through",
    },
    {
      tag: [tags.meta],
      fontWeight: 300,
      color: "var(--syntax-meta, #999)",
      fontFamily: "var(--text-editor-family-sans)",
    },
    { tag: tags.keyword, ...baseCodeStyles, color: "var(--syntax-keyword, #708)" },
    {
      tag: [tags.atom, tags.bool, tags.contentSeparator, tags.labelName],
      ...baseCodeStyles,
      color: "var(--syntax-atom, var(--studio-secondary))",
    },
    {
      tag: tags.url,
      ...baseCodeStyles,
      color: "var(--syntax-atom, var(--studio-secondary))",
      ...breakUrl,
    },
    { tag: bareUrl, fontFamily: bodyFont(style), ...breakUrl },
    { tag: [tags.literal, tags.inserted], ...baseCodeStyles, color: "var(--syntax-inserted, #164)" },
    { tag: [tags.string, tags.deleted], ...baseCodeStyles, color: "var(--syntax-string, #5f67b5)" },
    {
      tag: [tags.regexp, tags.escape, tags.special(tags.string)],
      ...baseCodeStyles,
      color: "var(--syntax-regexp, #e40)",
    },
    {
      tag: tags.definition(tags.variableName),
      ...baseCodeStyles,
      color: "var(--syntax-definition--variable-name, #00f)",
    },
    { tag: tags.local(tags.variableName), ...baseCodeStyles, color: "var(--syntax-variable-name, #30a)" },
    { tag: [tags.typeName, tags.namespace], ...baseCodeStyles, color: "var(--syntax-type-name, #085)" },
    { tag: tags.className, ...baseCodeStyles, color: "var(--syntax-class-name, #167)" },
    {
      tag: [tags.special(tags.variableName), tags.macroName],
      ...baseCodeStyles,
      color: "var(--syntax-special--variable-name, #256)",
    },
    {
      tag: tags.definition(tags.propertyName),
      ...baseCodeStyles,
      color: "var(--syntax-function--property-name, #00c)",
    },
    { tag: tags.monospace, ...baseCodeStyles },
  ]);

export const theme = (style: "serif" | "sans") => [
  EditorView.theme({ ...markdownStyles(style), ...headingLines }),
  syntaxHighlighting(markdownSyntaxHighlighting(style)),
];

