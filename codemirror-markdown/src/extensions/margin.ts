import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * Bear-style margin: block markers hang out to the left of the text, so the
 * body text of headings, lists and quotes all starts on the same column.
 *
 *   H1 The title           (`# ` → H1 label)
 *    • a bullet            (`- ` → dot)
 *   3. a number            (the number it renders as, whatever was typed)
 *    ☐ a task              (`- [ ] ` → checkbox, no bullet)
 *    ┃ a quote             (`> ` → a bar)
 *
 * The markup itself is never shown, and the caret never goes into it: see
 * prefix.ts.
 *
 * Everything hung goes in a `.cm-md-hang` box: a fixed-width inline-flex with
 * a negative margin of the same width, so it takes no room on the line and
 * whatever it holds sits right-aligned in the margin. Its width is in rem so a
 * big heading doesn't hang further out than a paragraph.
 */

const hidden = Decoration.replace({});
// inclusive, so it wraps the checkbox widget tasks.ts puts at its very start.
const taskMark = Decoration.mark({
  class: "cm-md-hang cm-md-list-marker",
  inclusive: true,
});

class HeadingLabel extends WidgetType {
  /** `shown` only on the caret's line; elsewhere it keeps its room, unseen. */
  constructor(readonly level: number, readonly shown: boolean) {
    super();
  }
  eq(other: HeadingLabel) {
    return other.level === this.level && other.shown === this.shown;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-md-hang cm-md-heading-label${this.shown ? "" : " cm-md-heading-label-idle"}`;
    span.setAttribute("aria-hidden", "true");
    const n = document.createElement("span");
    n.className = "cm-md-heading-level";
    n.textContent = String(this.level);
    span.append("H", n);
    return span;
  }
}

class Bullet extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-hang cm-md-list-marker";
    const dot = document.createElement("span");
    dot.className = "cm-bullet";
    span.append(dot);
    return span;
  }
}

class NumberLabel extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: NumberLabel) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-hang cm-md-list-marker cm-md-hang-number";
    span.textContent = this.text;
    return span;
  }
}

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/**
 * What an ordered list mark renders as: CommonMark numbers a list from its
 * first item's number and counts up, whatever the later items say, so
 * `1. 2. 10.` is 1, 2, 3. The source is left alone — rewriting it would race
 * other people renumbering the same list — and the margin shows the truth.
 */
function renderedNumber(state: EditorState, mark: SyntaxNode) {
  const text = state.doc.sliceString(mark.from, mark.to);
  const delimiter = text.slice(-1);
  let item = mark.parent;
  if (!item || item.name !== "ListItem") return text;
  let index = 0;
  let first = item;
  for (let prev = item.prevSibling; prev; prev = prev.prevSibling) {
    if (prev.name !== "ListItem") continue;
    index++;
    first = prev;
  }
  const firstMark = first.getChild("ListMark");
  const start = firstMark
    ? parseInt(state.doc.sliceString(firstMark.from, firstMark.to), 10)
    : 1;
  const n = (Number.isNaN(start) ? 1 : start) + index;
  // nested ordered lists count the way GitHub draws them: 1. → i. → a.
  let depth = 0;
  for (let p = item.parent?.parent; p; p = p.parent)
    if (p.name === "OrderedList") depth++;
  return `${counter(n, depth)}${delimiter}`;
}

/** `n` in the style for an ordered list `depth` lists deep. */
export function counter(n: number, depth: number) {
  const style = depth % 3;
  if (style === 1 && n > 0 && n < 4000) return roman(n);
  if (style === 2 && n > 0) return alpha(n);
  return String(n);
}

function roman(n: number) {
  const numerals: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  for (const [value, numeral] of numerals)
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  return out;
}

function alpha(n: number) {
  let out = "";
  while (n > 0) {
    n--;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

const codeLine = Decoration.line({ class: "cm-md-code" });
const inlineCode = Decoration.mark({ class: "cm-md-inline-code" });
const calloutMarker = Decoration.mark({ class: "cm-md-callout-marker" });

/** Lines holding any part of the selection: a callout's `[!NOTE]` shows as
 *  text on them, so its type can be changed. */
function caretLines(state: EditorState) {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const last = state.doc.lineAt(r.to).number;
    for (let n = state.doc.lineAt(r.from).number; n <= last; n++) lines.add(n);
  }
  return lines;
}

export const CALLOUTS = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
} as const;
export type CalloutType = keyof typeof CALLOUTS;

/**
 * A GitHub-style callout's marker on the first line of a quote:
 * `> [!NOTE]`, any case. Text after it (`> [!TIP] Shortcuts`) is taken as the
 * title, as Obsidian does; GitHub would leave it in the body.
 */
function calloutAt(line: { from: number; text: string }) {
  let cursor = 0;
  let quoteDepth = 0;
  while (true) {
    const beforeWhitespace = cursor;
    while (/\s/.test(line.text[cursor] ?? "")) cursor++;
    if (line.text[cursor] !== ">") {
      cursor = beforeWhitespace;
      break;
    }
    cursor++;
    if (/\s/.test(line.text[cursor] ?? "")) cursor++;
    quoteDepth++;
  }
  if (!quoteDepth) return null;

  const m = /^\[!(\w+)\][ \t]*(.*)$/.exec(line.text.slice(cursor));
  if (!m) return null;
  const type = m[1].toLowerCase();
  if (!(type in CALLOUTS)) return null;
  const from = line.from + cursor;
  return {
    type: type as CalloutType,
    from,
    to: line.from + line.text.length - m[2].length,
    titled: m[2].trim() !== "",
  };
}

// 16×16, stroked in currentColor.
const ICONS: Record<CalloutType, string> = {
  note: '<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v4M8 4.75v.01"/>',
  tip: '<path d="M5.75 11.5h4.5M6.5 14h3M8 1.75a4.25 4.25 0 0 0-2.5 7.7c.5.4.75.9.75 1.55V11.5h3.5V11c0-.65.25-1.15.75-1.55A4.25 4.25 0 0 0 8 1.75z"/>',
  important: '<path d="M2.25 3.25a1.5 1.5 0 0 1 1.5-1.5h8.5a1.5 1.5 0 0 1 1.5 1.5v6.5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5v-2.5h-.25a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M8 4.5v3M8 9.5v.01"/>',
  warning: '<path d="M7.13 2.25a1 1 0 0 1 1.74 0l5.6 9.75a1 1 0 0 1-.87 1.5H2.4a1 1 0 0 1-.87-1.5z"/><path d="M8 6v3M8 11v.01"/>',
  caution: '<path d="M5.5 1.75h5l3.75 3.75v5l-3.75 3.75h-5L1.75 10.5v-5z"/><path d="M8 5v3.5M8 10.75v.01"/>',
};

class CalloutTitle extends WidgetType {
  constructor(readonly type: CalloutType, readonly label: boolean) {
    super();
  }
  eq(other: CalloutTitle) {
    return other.type === this.type && other.label === this.label;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-callout-title";
    span.innerHTML =
      `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" ` +
      `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[this.type]}</svg>`;
    if (this.label) span.append(CALLOUTS[this.type]);
    else span.setAttribute("aria-label", CALLOUTS[this.type]);
    return span;
  }
}

/**
 * Lists are laid out with indentation, not spaces: every line in one is
 * padded by its depth (one list indent per list it's in), its markdown
 * indentation is hidden, and the marker sits in the padding — on the body's
 * column at the top level — so an item's text, and its wrapped lines, start
 * one indent in.
 */
function listLines(
  state: EditorState,
  from: number,
  to: number,
  decos: Range<Decoration>[]
) {
  const { doc } = state;
  const tree = syntaxTree(state);
  const last = doc.lineAt(to).number;
  for (let n = doc.lineAt(from).number; n <= last; n++) {
    const line = doc.line(n);
    const indent = /^[ \t]*/.exec(line.text)![0].length;
    if (indent === line.length) continue; // blank
    let depth = 0;
    let code = false;
    for (
      let node: SyntaxNode | null = tree.resolveInner(line.from + indent, 1);
      node;
      node = node.parent
    ) {
      if (node.name === "ListItem") depth++;
      if (node.name === "FencedCode" || node.name === "CodeBlock") code = true;
    }
    if (!depth) continue;
    decos.push(
      Decoration.line({
        class: "cm-md-list-line",
        attributes: { style: `--md-list-depth: ${depth}` },
      }).range(line.from)
    );
    // code keeps its spaces: they're part of what it says.
    if (indent && !code) decos.push(hidden.range(line.from, line.from + indent));
  }
}

/** `pos` moved past any spaces (not newlines) that follow it. */
function skipSpaces(state: EditorState, pos: number) {
  const line = state.doc.lineAt(pos);
  while (pos < line.to && state.doc.sliceString(pos, pos + 1) === " ") pos++;
  return pos;
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const editing = caretLines(state);
  const decos: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;

        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          const mark = node.node.firstChild;
          if (!mark || mark.name !== "HeaderMark") return;
          const line = doc.lineAt(node.from);
          decos.push(
            Decoration.replace({
              widget: new HeadingLabel(Number(heading[1]), editing.has(line.number)),
            }).range(line.from, skipSpaces(state, mark.to)),
            // the heading's size on the whole line, for what the highlighter
            // doesn't wrap (a rendered link): see headingLines in the theme.
            Decoration.line({ class: `cm-md-h${heading[1]}` }).range(line.from)
          );
          return;
        }

        if (name === "ListMark") {
          const end = skipSpaces(state, node.to);
          const char = doc.sliceString(node.from, node.to);
          const bullet = ["-", "+", "*"].includes(char);
          const task = node.node.nextSibling?.firstChild;
          const isTask =
            bullet &&
            task?.name === "TaskMarker" &&
            doc.sliceString(end, task.from).trim() === "";
          if (isTask && task) {
            // the checkbox takes the bullet's place: drop the mark, and hang
            // the task marker (which tasks.ts draws as a checkbox).
            if (end > node.from) decos.push(hidden.range(node.from, end));
            decos.push(taskMark.range(task.from, task.to));
            // the space after the box is hidden, not hung: hung, the caret
            // at the start of the text would be drawn at the end of the hang.
            const after = skipSpaces(state, task.to);
            if (after > task.to) decos.push(hidden.range(task.to, after));
            return;
          }
          if (bullet) {
            decos.push(
              Decoration.replace({ widget: new Bullet() }).range(node.from, end)
            );
          } else {
            decos.push(
              Decoration.replace({
                widget: new NumberLabel(renderedNumber(state, node.node)),
              }).range(node.from, end)
            );
          }
          return;
        }

        if (
          (name === "BulletList" || name === "OrderedList") &&
          node.node.parent?.name !== "ListItem"
        ) {
          listLines(state, node.from, node.to, decos);
          return; // carry on into it for its marks
        }

        if (name === "FencedCode" || name === "CodeBlock") {
          // every line in the code font, whether or not its language
          // highlighter tags each word: untagged text would otherwise take
          // the body font.
          const first = doc.lineAt(node.from).number;
          const last = doc.lineAt(node.to).number;
          for (let n = first; n <= last; n++) {
            const ends =
              (n === first ? " cm-md-code-first" : "") +
              (n === last ? " cm-md-code-last" : "");
            decos.push(
              (ends ? Decoration.line({ class: "cm-md-code" + ends }) : codeLine).range(
                doc.line(n).from
              )
            );
          }
          return false;
        }

        if (name === "InlineCode") {
          // one tinted pill for the whole thing, backticks and all
          decos.push(inlineCode.range(node.from, node.to));
          return false;
        }

        if (name === "Blockquote") {
          // one bar per quote, however deeply it nests.
          for (let p = node.node.parent; p; p = p.parent)
            if (p.name === "Blockquote") return;
          const first = doc.lineAt(node.from).number;
          const last = doc.lineAt(node.to).number;
          const callout = calloutAt(doc.line(first));
          for (let n = first; n <= last; n++) {
            const line = doc.line(n);
            const classes = ["cm-md-quote"];
            if (n === first) classes.push("cm-md-quote-first");
            if (n === last) classes.push("cm-md-quote-last");
            if (callout) {
              classes.push("cm-md-callout", `cm-md-callout-${callout.type}`);
              if (n === first) classes.push("cm-md-callout-title-line");
            }
            decos.push(
              Decoration.line({ class: classes.join(" ") }).range(line.from)
            );
          }
          if (callout) {
            decos.push(
              editing.has(first)
                ? calloutMarker.range(callout.from, callout.to)
                : Decoration.replace({
                    widget: new CalloutTitle(callout.type, !callout.titled),
                  }).range(callout.from, callout.to)
            );
          }
          return; // carry on into it for its QuoteMarks
        }

        if (name === "QuoteMark") {
          const line = doc.lineAt(node.from);
          // only the first mark on a line starts the prefix; `>>` nests.
          const before = doc.sliceString(line.from, node.from);
          if (before.trim() !== "") return;
          let end = node.to;
          for (;;) {
            const next = skipSpaces(state, end);
            if (doc.sliceString(next, next + 1) !== ">") break;
            end = next + 1;
          }
          end = skipSpaces(state, end);
          decos.push(hidden.range(line.from, end));
        }
      },
    });
  }

  return Decoration.set(decos, true);
}

const marginPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

const zoomed = (length: string) => `calc(${length} * var(--markdown-zoom, 1))`;

const marginTheme = EditorView.baseTheme({
  ".cm-content": {
    "--markdown-hang": zoomed("2.5rem"),
    "--markdown-list-indent": zoomed("1.6rem"),
    "--markdown-quote-indent": zoomed("1.1rem"),
  },
  ".cm-md-hang": {
    display: "inline-flex",
    justifyContent: "flex-end",
    alignItems: "baseline",
    boxSizing: "border-box",
    width: "var(--markdown-hang)",
    marginLeft: "calc(-1 * var(--markdown-hang))",
    paddingRight: zoomed("0.6rem"),
    whiteSpace: "pre",
    // a heading's raw `## ` shrinks to label size so it fits the margin.
    fontSize: zoomed("0.8rem"),
    color: "var(--text-editor-line-offset-40, #999)",
    fontWeight: "normal",
    fontStyle: "normal",
    textDecoration: "none",
  },
  // highlight spans inside the box (a heading's `##`) keep their own size and
  // margins otherwise, and as flex items those margins would push the line.
  ".cm-md-hang *": {
    fontSize: "inherit",
    margin: "0",
  },
  ".cm-md-hang-number": {
    fontSize: "inherit",
    color: "inherit",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-md-heading-label": {
    fontFamily: "var(--markdown-body-family, inherit)",
    letterSpacing: "0.02em",
  },
  ".cm-md-heading-label-idle": {
    visibility: "hidden",
  },
  // a list line: padded one indent per level (CodeMirror's own 6px first)
  ".cm-md-list-line": {
    paddingLeft: "calc(6px + var(--md-list-depth, 1) * var(--markdown-list-indent))",
  },
  // its marker, in that padding: from the start of the indent, not hung right
  ".cm-md-list-marker": {
    width: "var(--markdown-list-indent)",
    marginLeft: "calc(-1 * var(--markdown-list-indent))",
    justifyContent: "flex-start",
    paddingRight: "0",
  },
  ".cm-md-heading-level": {
    fontSize: "0.75em",
    verticalAlign: "-0.15em",
  },
  ".cm-md-hang .cm-bullet": {
    display: "inline-block",
    width: "0.5em",
    height: "0.5em",
    // in the box's left, centred under where a number's first digit sits
    marginLeft: "0.15em",
    borderRadius: "50%",
    // theming's list marker colour (the primary accent, as ink)
    background:
      "var(--syntax-list-marker, var(--text-editor-primary-text, currentColor))",
    alignSelf: "center",
  },
  ".cm-md-hang .cm-task": {
    margin: "0",
  },
  // a quote: its bar on the body's column, its text one quote indent in
  ".cm-md-quote": {
    position: "relative",
    paddingLeft: "calc(6px + var(--markdown-quote-indent))",
  },
  // code sits on a faint step up the editor's fill ramp: inline, a pill;
  // a block, a rounded panel with a little room inside
  ".cm-md-code": {
    fontFamily: "var(--text-editor-family-code)",
    background: "var(--text-editor-fill-offset-10, rgb(0 0 0 / 0.04))",
    paddingInline: `calc(6px + ${zoomed("0.75rem")})`,
  },
  ".cm-md-code-first": {
    paddingTop: zoomed("0.5rem"),
    borderTopLeftRadius: "6px",
    borderTopRightRadius: "6px",
  },
  ".cm-md-code-last": {
    paddingBottom: zoomed("0.5rem"),
    borderBottomLeftRadius: "6px",
    borderBottomRightRadius: "6px",
  },
  ".cm-md-inline-code": {
    background: "var(--text-editor-fill-offset-10, rgb(0 0 0 / 0.04))",
    borderRadius: "4px",
    padding: "0.1em 0.3em",
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
  },

  // GitHub-style callouts. Colours from theming's --studio-callout-* (the
  // accent: bar) and --text-editor-callout-*-text/-fill (title ink, box
  // tint), with fallbacks for running without the theme.
  ...Object.fromEntries(
    (Object.keys(CALLOUTS) as CalloutType[]).map((type) => {
      const fallback = { note: "#36e", tip: "#1a7f37", important: "#8250df", warning: "#d4a72c", caution: "#d1242f" }[type];
      return [
        `.cm-md-callout-${type}`,
        {
          "--md-callout": `var(--studio-callout-${type}, ${fallback})`,
          "--md-callout-text": `var(--text-editor-callout-${type}-text, color-mix(in oklch, var(--md-callout), currentColor 35%))`,
          "--md-callout-fill": `var(--text-editor-callout-${type}-fill, color-mix(in oklch, var(--md-callout) 9%, transparent))`,
        },
      ];
    })
  ),
  ".cm-md-callout": {
    // the body reads as body text, not as a quote: the theme's quote styling
    // (italic, the punctuation grey) comes through these variables.
    "--syntax-quote": "var(--text-editor-line)",
    "--syntax-style-quote": "normal",
    "--syntax-weight-quote": "normal",
    "--syntax-fill-quote": "transparent",
    // a stacking context, so the tint drawn behind the text (z-index -1)
    // stays above the editor's own background.
    isolation: "isolate",
    paddingRight: zoomed("0.75rem"),
  },
  // (doubled up to outrank the plain quote bar's rule further down)
  ".cm-md-quote.cm-md-callout::before": {
    background: "var(--md-callout)",
    opacity: "1",
  },
  ".cm-md-callout::after": {
    content: '""',
    position: "absolute",
    zIndex: "-1",
    left: "6px",
    right: "0",
    top: "0",
    bottom: "0",
    background: "var(--md-callout-fill)",
  },
  ".cm-md-callout.cm-md-quote-first": {
    paddingTop: zoomed("0.5rem"),
  },
  ".cm-md-callout.cm-md-quote-last": {
    paddingBottom: zoomed("0.5rem"),
  },
  ".cm-md-callout.cm-md-quote-first::before, .cm-md-callout.cm-md-quote-first::after": {
    top: "0",
    borderTopRightRadius: "6px",
  },
  ".cm-md-callout.cm-md-quote-last::before, .cm-md-callout.cm-md-quote-last::after": {
    bottom: "0",
    borderBottomRightRadius: "6px",
  },
  ".cm-md-callout.cm-md-quote-first::before": { borderTopRightRadius: "0" },
  ".cm-md-callout.cm-md-quote-last::before": { borderBottomRightRadius: "0" },
  ".cm-md-callout-title-line": {
    color: "var(--md-callout-text)",
    fontWeight: "600",
  },
  ".cm-md-callout-title": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4em",
    color: "var(--md-callout-text)",
    fontWeight: "600",
    marginRight: "0.4em",
  },
  ".cm-md-callout-title svg": {
    width: "1em",
    height: "1em",
    flex: "none",
  },
  // the raw `[!NOTE]`, on the caret's line. it parses as a reference link,
  // so the highlighter's link colour and underline are undone inside it.
  ".cm-md-callout-marker, .cm-md-callout-marker *": {
    color: "var(--md-callout-text)",
    textDecoration: "none",
  },
  ".cm-md-callout-marker": {
    fontFamily: "var(--text-editor-family-code)",
    fontSize: "0.9em",
  },
  ".cm-md-quote::before": {
    content: '""',
    position: "absolute",
    // on the body's column (past CodeMirror's own 6px line padding)
    left: "6px",
    top: "0",
    bottom: "0",
    width: "3px",
    background: "var(--syntax-quote-bar, var(--studio-link, currentColor))",
    opacity: "0.6",
  },
  ".cm-md-quote-first::before": {
    top: "0.2em",
    borderTopLeftRadius: "3px",
    borderTopRightRadius: "3px",
  },
  ".cm-md-quote-last::before": {
    bottom: "0.2em",
    borderBottomLeftRadius: "3px",
    borderBottomRightRadius: "3px",
  },
});

export const margin = [marginPlugin, marginTheme];
