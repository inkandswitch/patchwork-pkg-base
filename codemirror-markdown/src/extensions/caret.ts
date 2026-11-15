// The caret dresses like the text it's in: heavier inside bold, leaning inside
// italics, crossed in strikethrough, a block in code. Mimi Reyburn's idea, as lush's rich text editor has it.
//
// The native caret can't do that, so this draws the main caret in a layer of
// its own (the way drawSelection does) and hides the native one. What the
// caret wears comes from the syntax tree rather than computed style: what
// counts is what you'd type there, so `**bold**|` gets a plain caret even
// though the `*` before it is drawn bold.
import type { EditorState } from "@codemirror/state";
import { Prec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { EditorView, RectangleMarker, layer } from "@codemirror/view";

export type CaretMarks = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
};

type Node = { name: string; from: number; to: number };

/** Inline spans: the caret wears the format between the marks, edges included. */
const INLINE: Record<string, [mark: string, format: keyof CaretMarks]> = {
  StrongEmphasis: ["EmphasisMark", "bold"],
  Emphasis: ["EmphasisMark", "italic"],
  Strikethrough: ["StrikethroughMark", "strike"],
  InlineCode: ["CodeMark", "code"],
};

const isMark = (node: Node | null, name: string): node is Node =>
  node?.name === name;

/** What text typed at `pos` would come out as. */
export function caretMarks(state: EditorState, pos: number): CaretMarks {
  const marks = { bold: false, italic: false, strike: false, code: false };
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter(ref) {
      const node = ref.node;
      const name = node.name;
      const inline = INLINE[name];
      if (inline) {
        const [mark, format] = inline;
        const open = node.firstChild;
        const close = node.lastChild;
        if (
          isMark(open, mark) &&
          isMark(close, mark) &&
          open.from !== close.from &&
          pos >= open.to &&
          pos <= close.from
        ) {
          marks[format] = true;
        }
      } else if (/^ATXHeading\d$/.test(name)) {
        const open = node.firstChild;
        if (!isMark(open, "HeaderMark") || pos > open.to) marks.bold = true;
      } else if (/^SetextHeading\d$/.test(name)) {
        const underline = node.lastChild;
        if (!isMark(underline, "HeaderMark") || pos < underline.from) marks.bold = true;
      } else if (name === "CodeBlock") {
        marks.code = true;
      } else if (name === "FencedCode") {
        // the lines between the fences, not the fences themselves.
        const open = node.firstChild;
        const close = node.lastChild;
        const body = isMark(open, "CodeMark") ? state.doc.lineAt(open.to).to : node.from;
        const end =
          isMark(close, "CodeMark") && open && close.from !== open.from
            ? state.doc.lineAt(close.from).from
            : node.to + 1;
        if (pos > body && pos < end) marks.code = true;
      }
    },
  });
  return marks;
}

const caretLayer = layer({
  above: true,
  class: "cm-markdownCaretLayer",
  markers(view) {
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty || !state.facet(EditorView.editable)) return [];
    const marks = caretMarks(state, sel.head);
    let className = "cm-markdownCaret";
    for (const format of ["bold", "italic", "strike", "code"] as const) {
      if (marks[format]) className += ` cm-markdownCaret-${format}`;
    }
    return RectangleMarker.forRange(view, className, sel);
  },
  update(update, dom) {
    // restart the blink whenever the caret moves, so it's solid while you work.
    if (update.transactions.some((tr) => tr.selection)) {
      dom.style.animationName =
        dom.style.animationName === "cm-markdownCaret-blink"
          ? "cm-markdownCaret-blink2"
          : "cm-markdownCaret-blink";
    }
    return (
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged ||
      syntaxTree(update.state) !== syntaxTree(update.startState) ||
      update.state.facet(EditorView.editable) !==
        update.startState.facet(EditorView.editable)
    );
  },
});

const caretTheme = EditorView.baseTheme({
  "@keyframes cm-markdownCaret-blink": { "0%": {}, "50%": { opacity: 0 }, "100%": {} },
  "@keyframes cm-markdownCaret-blink2": { "0%": {}, "50%": { opacity: 0 }, "100%": {} },
  ".cm-markdownCaretLayer": {
    pointerEvents: "none",
    display: "none",
  },
  "&.cm-focused > .cm-scroller > .cm-markdownCaretLayer": {
    display: "block",
    animation: "steps(1) cm-markdownCaret-blink 1.2s infinite",
  },
  ".cm-markdownCaret": {
    borderLeft: "1.8px solid var(--text-editor-cursor-fill, currentColor)",
    marginLeft: "-0.9px",
  },
  ".cm-markdownCaret-bold": {
    borderLeftWidth: "2.4px",
    marginLeft: "-1.2px",
  },
  ".cm-markdownCaret-italic": {
    transform: "rotate(10deg)",
  },
  // struck through: a short bar across the caret where the strike runs.
  ".cm-markdownCaret-strike::after": {
    content: '""',
    position: "absolute",
    left: "-0.3em",
    width: "0.6em",
    top: "55%",
    borderTop: "1.5px solid var(--text-editor-cursor-fill, currentColor)",
  },
  // code: a terminal's block, one code-font character wide, behind the bar.
  ".cm-markdownCaret-code": {
    fontFamily: "var(--text-editor-family-code, monospace)",
    width: "1ch",
    background:
      "color-mix(in srgb, var(--text-editor-cursor-fill, currentColor) 30%, transparent)",
  },
});

// The drawn caret replaces the native one; inputs inside widgets keep theirs.
const hideNativeCaret = Prec.highest(
  EditorView.theme({
    ".cm-content": { caretColor: "transparent !important" },
    ".cm-content :focus": { caretColor: "auto !important" },
  })
);

export const formattedCaret = [caretLayer, caretTheme, hideNativeCaret];
