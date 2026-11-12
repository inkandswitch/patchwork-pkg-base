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
 *   H1 The title           (`# ` → H1 label, always: see headings.ts)
 *    • a bullet            (`- ` → dot)
 *   3. a number            (the number it renders as; raw on the caret line)
 *    ☐ a task              (`- [ ] ` → checkbox, no bullet)
 *    ┃ a quote             (`> ` → a bar; raw `> ` while the caret's on it)
 *
 * Everything hung goes in a `.cm-md-hang` box: a fixed-width inline-flex with
 * a negative margin of the same width, so it takes no room on the line and
 * whatever it holds sits right-aligned in the margin. Its width is in rem so a
 * big heading doesn't hang further out than a paragraph.
 */

const numberMark = Decoration.mark({ class: "cm-md-hang cm-md-hang-number" });
const quoteMark = Decoration.mark({ class: "cm-md-hang cm-md-hang-quote" });
const hidden = Decoration.replace({});
// inclusive, so it wraps the checkbox widget tasks.ts puts at its very start.
const taskMark = Decoration.mark({ class: "cm-md-hang", inclusive: true });

class HeadingLabel extends WidgetType {
  constructor(readonly level: number) {
    super();
  }
  eq(other: HeadingLabel) {
    return other.level === this.level;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-hang cm-md-heading-label";
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
    span.className = "cm-md-hang";
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
    span.className = "cm-md-hang cm-md-hang-number";
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
  return `${(Number.isNaN(start) ? 1 : start) + index}${delimiter}`;
}

/** Lines that hold any part of the selection: those show their raw markup. */
function caretLines(state: EditorState) {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
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
          if (!mark || mark.name !== "HeaderMark" || mark.from !== node.from)
            return;
          decos.push(
            Decoration.replace({
              widget: new HeadingLabel(Number(heading[1])),
            }).range(mark.from, skipSpaces(state, mark.to))
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
            decos.push(taskMark.range(task.from, skipSpaces(state, task.to)));
            return;
          }
          if (bullet) {
            decos.push(
              Decoration.replace({ widget: new Bullet() }).range(node.from, end)
            );
          } else if (editing.has(doc.lineAt(node.from).number)) {
            decos.push(numberMark.range(node.from, end));
          } else {
            decos.push(
              Decoration.replace({
                widget: new NumberLabel(renderedNumber(state, node.node)),
              }).range(node.from, end)
            );
          }
          return;
        }

        if (name === "Blockquote") {
          // one bar per quote, however deeply it nests.
          for (let p = node.node.parent; p; p = p.parent)
            if (p.name === "Blockquote") return;
          const first = doc.lineAt(node.from).number;
          const last = doc.lineAt(node.to).number;
          for (let n = first; n <= last; n++) {
            const line = doc.line(n);
            const classes = ["cm-md-quote"];
            if (n === first) classes.push("cm-md-quote-first");
            if (n === last) classes.push("cm-md-quote-last");
            decos.push(
              Decoration.line({ class: classes.join(" ") }).range(line.from)
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
          decos.push(
            (editing.has(line.number) ? quoteMark : hidden).range(
              line.from,
              end
            )
          );
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
  ".cm-md-heading-level": {
    fontSize: "0.75em",
    verticalAlign: "-0.15em",
  },
  ".cm-md-hang .cm-bullet": {
    display: "inline-block",
    width: "0.4em",
    height: "0.4em",
    borderRadius: "50%",
    background: "var(--syntax-list-marker, currentColor)",
    color: "var(--text-editor-line)",
    alignSelf: "center",
  },
  ".cm-md-hang .cm-task": {
    margin: "0",
  },
  ".cm-md-quote": {
    position: "relative",
  },
  ".cm-md-quote::before": {
    content: '""',
    position: "absolute",
    // centred in the left half of the margin, clear of a hung `>`.
    left: "calc(-0.5 * var(--markdown-hang))",
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
