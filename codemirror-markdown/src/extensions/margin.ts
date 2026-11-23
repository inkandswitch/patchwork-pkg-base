import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Line, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { selectedOver } from "./selected.ts";

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
const selectedTaskMark = Decoration.mark({
  class: "cm-md-hang cm-md-list-marker cm-md-list-marker-selected",
  inclusive: true,
});

/** The browser's own selection doesn't paint widgets, so a list marker over
 *  selected markup is tinted by hand: see `.cm-md-list-marker-selected`. */
const MARKER_SELECTED = " cm-md-list-marker-selected";

class HeadingLabel extends WidgetType {
  /** `shown` only on the caret's line; elsewhere it keeps its room, unseen.
   *  `selected`: its `#`s are under a selection. */
  constructor(
    readonly level: number,
    readonly shown: boolean,
    readonly selected = false
  ) {
    super();
  }
  eq(other: HeadingLabel) {
    return (
      other.level === this.level &&
      other.shown === this.shown &&
      other.selected === this.selected
    );
  }
  toDOM() {
    const span = document.createElement("span");
    span.className =
      "cm-md-hang cm-md-heading-label" +
      (this.shown ? "" : " cm-md-heading-label-idle") +
      (this.selected ? " cm-md-heading-label-selected" : "");
    span.setAttribute("aria-hidden", "true");
    // the text in a box of its own, to be picked out while the level menu
    // (headings.ts) is open, without the hang's empty room around it
    const text = document.createElement("span");
    text.className = "cm-md-heading-text";
    const n = document.createElement("span");
    n.className = "cm-md-heading-level";
    n.textContent = String(this.level);
    text.append("H", n);
    span.append(text);
    return span;
  }
}

/** Bullets change shape with depth, as HTML's do: a dot, a ring, a diamond,
 *  then round again. */
const BULLET_SHAPES = ["disc", "circle", "diamond"] as const;

class Bullet extends WidgetType {
  /** `shift`: a style moving it out past what's nested in its item on its
   *  line (see markerShift) */
  constructor(
    readonly shape: (typeof BULLET_SHAPES)[number],
    readonly shift?: string,
    readonly selected = false
  ) {
    super();
  }
  eq(other: Bullet) {
    return (
      other.shape === this.shape &&
      other.shift === this.shift &&
      other.selected === this.selected
    );
  }
  toDOM() {
    const span = document.createElement("span");
    span.className =
      "cm-md-hang cm-md-list-marker" + (this.selected ? MARKER_SELECTED : "");
    if (this.shift) span.setAttribute("style", this.shift);
    const dot = document.createElement("span");
    dot.className = `cm-bullet cm-bullet-${this.shape}`;
    span.append(dot);
    return span;
  }
}

/** How many bullet lists deep a list mark is (1 at the top). */
function bulletDepth(mark: SyntaxNode) {
  let depth = 0;
  for (let n = mark.parent; n; n = n.parent) if (n.name === "BulletList") depth++;
  return Math.max(1, depth);
}

class Rule extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-md-hr";
    hr.setAttribute("role", "separator");
    return hr;
  }
}

class NumberLabel extends WidgetType {
  constructor(
    readonly text: string,
    readonly shift?: string,
    readonly selected = false
  ) {
    super();
  }
  eq(other: NumberLabel) {
    return (
      other.text === this.text &&
      other.shift === this.shift &&
      other.selected === this.selected
    );
  }
  toDOM() {
    const span = document.createElement("span");
    span.className =
      "cm-md-hang cm-md-list-marker cm-md-hang-number" +
      (this.selected ? MARKER_SELECTED : "");
    if (this.shift) span.setAttribute("style", this.shift);
    span.textContent = this.text;
    return span;
  }
}

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/**
 * A list or heading mark with nothing after it, not even its space: `-`,
 * `1.`, `##`. CommonMark makes it an empty item or heading, but it's almost
 * always a marker (or a rule, or a number, or a hashtag) still being typed, so
 * it's left as typed until its space comes — drawn as a dot, `-a` would look
 * like `- a` until the `a` showed it wasn't; drawn as a heading, `#` would
 * jump to a big empty H1 at the first keystroke.
 */
function bareMark(state: EditorState, mark: SyntaxNode) {
  if (mark.name !== "ListMark" && mark.name !== "HeaderMark") return false;
  const line = state.doc.lineAt(mark.from);
  // an item whose text starts on the next line (`-\n  a`) isn't bare
  return mark.to === line.to && (!mark.parent || mark.parent.to <= line.to);
}

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
 * Quotes and lists nest, in any mix, and are laid out with indentation, not
 * markup: a line is padded one indent for every quote and list item it's in
 * (its *containers*, outermost first), the `>`s and spaces in front of it are
 * hidden, and what marks each container goes in that padding. A quote draws a
 * bar down its own indent; a list item's marker sits in its indent on the
 * item's first line. So text, and its wrapped lines, start one indent in per
 * level, and the markers of `> - x` sit side by side rather than on top of
 * each other.
 */
type Quote = {
  kind: "quote";
  from: number;
  /** its first and last line numbers */
  first: number;
  last: number;
  callout: ReturnType<typeof calloutAt>;
};
type Item = { kind: "list"; from: number };
type Container = Quote | Item;

/** how far in a run of containers reaches, as CSS */
function inset(containers: readonly Container[]) {
  let quotes = 0;
  let items = 0;
  for (const c of containers) c.kind === "quote" ? quotes++ : items++;
  return (
    `calc(${quotes} * var(--markdown-quote-indent) + ` +
    `${items} * var(--markdown-list-indent))`
  );
}

/** One bar for each quote a line is in, each down its own indent. */
type Bar = { left: string; first: boolean; last: boolean; callout?: CalloutType };

class QuoteBars extends WidgetType {
  /** `selected`: the line's `>`s are under a selection, so each bar's indent
   *  is tinted as the selected text beside it is */
  constructor(readonly bars: Bar[], readonly selected = false) {
    super();
  }
  eq(other: QuoteBars) {
    return (
      other.selected === this.selected &&
      JSON.stringify(other.bars) === JSON.stringify(this.bars)
    );
  }
  toDOM() {
    // empty and in the flow, so it takes no room and a caret beside it is
    // drawn at the text; the bars are placed against the line.
    const box = document.createElement("span");
    box.className = "cm-md-quote-bars";
    box.setAttribute("aria-hidden", "true");
    for (const bar of this.bars) {
      // (before its bar, so the bar is drawn over it)
      if (this.selected) {
        const band = document.createElement("span");
        band.className = "cm-md-quote-selected";
        band.setAttribute("style", `left: calc(6px + ${bar.left})`);
        box.append(band);
      }
      const span = document.createElement("span");
      span.className =
        "cm-md-quote-bar" +
        (bar.first ? " cm-md-quote-bar-first" : "") +
        (bar.last ? " cm-md-quote-bar-last" : "") +
        (bar.callout ? ` cm-md-callout-bar cm-md-callout-${bar.callout}` : "");
      span.setAttribute("style", `left: calc(6px + ${bar.left})`);
      box.append(span);
    }
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

type Layout = {
  /** each line's containers, outermost first, by line number */
  containers: Map<number, Container[]>;
  /** each code line's fence column, by line number: in a container, that
   *  much of its start is the container's markup, the rest is the code's */
  code: Map<number, number>;
};

/** Every visible line's containers, and where its code (if any) starts. */
function layout(view: EditorView): Layout {
  const { state } = view;
  const { doc } = state;
  const containers = new Map<number, Container[]>();
  const code = new Map<number, number>();
  // a callout belongs to the innermost quote starting on its line: in
  // `> > [!NOTE]` that's the inner one. (outer quotes are entered first.)
  const startingOn = new Map<number, Quote>();

  for (const { from, to } of view.visibleRanges) {
    const top = doc.lineAt(from).number;
    const bottom = doc.lineAt(to).number;
    const each = (node: { from: number; to: number }, f: (n: number) => void) => {
      const first = Math.max(top, doc.lineAt(node.from).number);
      const last = Math.min(bottom, doc.lineAt(node.to).number);
      for (let n = first; n <= last; n++) f(n);
    };
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        let c: Container | null = null;
        if (node.name === "Blockquote") {
          const first = doc.lineAt(node.from).number;
          c = { kind: "quote", from: node.from, first, last: doc.lineAt(node.to).number, callout: null };
          startingOn.set(first, c);
        } else if (node.name === "ListItem") {
          const mark = node.node.getChild("ListMark");
          if (mark && bareMark(state, mark)) return false;
          c = { kind: "list", from: node.from };
        } else if (node.name === "FencedCode" || node.name === "CodeBlock") {
          const column = node.from - doc.lineAt(node.from).from;
          each(node, (n) => code.set(n, column));
          return false;
        }
        if (c) {
          const container = c;
          each(node, (n) => {
            const list = containers.get(n);
            if (list) list.push(container);
            else containers.set(n, [container]);
          });
        }
      },
    });
  }

  for (const [first, quote] of startingOn) {
    quote.callout = calloutAt(doc.line(first));
  }
  return { containers, code };
}

/**
 * Where the markup at the start of a line in a container ends: the `>`s and
 * spaces before its text. In code, only up to the fence's column — the rest
 * of its indentation (and any `>` past it) is the code's own.
 */
function markupEnd(line: Line, codeColumn: number | undefined) {
  let end = /^[ \t>]*/.exec(line.text)![0].length;
  if (codeColumn !== undefined) end = Math.min(end, codeColumn);
  return line.from + end;
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
  const { containers, code } = layout(view);

  // every line decoration a line gets, merged into one
  const lineClasses = new Map<number, string[]>();
  const lineStyles = new Map<number, string[]>();
  const addLine = (n: number, cls: string, style?: string) => {
    const classes = lineClasses.get(n);
    if (classes) classes.push(cls);
    else lineClasses.set(n, [cls]);
    if (style) {
      const styles = lineStyles.get(n);
      if (styles) styles.push(style);
      else lineStyles.set(n, [style]);
    }
  };

  /**
   * A list marker sits in its item's indent: one indent left of the text,
   * unless the line's text is further in, inside something nested in the
   * item on the same line (`- > a quote`) — then it moves out past that too.
   */
  const markerShift = (line: Line, item: SyntaxNode | null) => {
    const on = containers.get(line.number);
    if (!on || !item) return undefined;
    const at = on.findIndex((c) => c.kind === "list" && c.from === item.from);
    const inner = at < 0 ? [] : on.slice(at + 1);
    if (!inner.length) return undefined;
    // out by that much more, and given it back after, so the text stays put
    return (
      `margin-left: calc(-1 * (var(--markdown-list-indent) + ${inset(inner)})); ` +
      `margin-right: ${inset(inner)}`
    );
  };

  const quotes = new Set<Quote>();
  for (const [n, on] of containers) {
    const line = doc.line(n);
    const end = markupEnd(line, code.get(n));
    if (end > line.from) decos.push(hidden.range(line.from, end));

    const items = on.filter((c) => c.kind === "list").length;
    addLine(n, "cm-md-inset", `--md-inset: ${inset(on)}`);
    if (items) addLine(n, "cm-md-list-line", `--md-list-depth: ${items}`);

    const bars: Bar[] = [];
    let callout: { quote: Quote; at: number } | null = null;
    on.forEach((c, at) => {
      if (c.kind !== "quote") return;
      quotes.add(c);
      bars.push({
        left: inset(on.slice(0, at)),
        first: n === c.first,
        last: n === c.last,
        ...(c.callout ? { callout: c.callout.type } : {}),
      });
      if (c.callout) callout = { quote: c, at };
    });
    if (!bars.length) continue;
    addLine(n, "cm-md-quote");
    if (bars.some((b) => b.first)) addLine(n, "cm-md-quote-first");
    if (bars.some((b) => b.last)) addLine(n, "cm-md-quote-last");
    decos.push(
      Decoration.widget({
        widget: new QuoteBars(bars, selectedOver(state, line.from, end)),
        side: -1,
      }).range(line.from)
    );
    // the innermost callout a line is in tints it, from that callout's bar
    if (callout) {
      const { quote, at } = callout as { quote: Quote; at: number };
      const type = quote.callout!.type;
      addLine(n, `cm-md-callout cm-md-callout-${type}`, `--md-callout-left: ${inset(on.slice(0, at))}`);
      if (n === quote.first) addLine(n, "cm-md-callout-title-line cm-md-callout-first");
      if (n === quote.last) addLine(n, "cm-md-callout-last");
    }
  }

  for (const quote of quotes) {
    const callout = quote.callout;
    if (!callout) continue;
    decos.push(
      editing.has(quote.first)
        ? calloutMarker.range(callout.from, callout.to)
        : Decoration.replace({
            widget: new CalloutTitle(callout.type, !callout.titled),
          }).range(callout.from, callout.to)
    );
  }

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
          // `#` with no space yet: left as typed, at the body's size.
          if (bareMark(state, mark)) {
            addLine(line.number, "cm-md-bare-heading");
            return;
          }
          // in a quote or list, the `>`s and spaces before it are already
          // hidden; the label replaces only the `#`s.
          const start = containers.has(line.number)
            ? markupEnd(line, undefined)
            : line.from;
          const end = skipSpaces(state, mark.to);
          decos.push(
            Decoration.replace({
              widget: new HeadingLabel(
                Number(heading[1]),
                editing.has(line.number),
                selectedOver(state, start, end)
              ),
            }).range(start, end)
          );
          // the heading's size on the whole line, for what the highlighter
          // doesn't wrap (a rendered link): see headingLines in the theme.
          addLine(line.number, `cm-md-h${heading[1]}`);
          return;
        }

        // `Title\n===`: the heading's size is on its line (as above), so the
        // text lines get it too — not the `===` under them.
        const setext = /^SetextHeading(\d)$/.exec(name);
        if (setext) {
          const underline = node.node.lastChild;
          if (!underline || underline.name !== "HeaderMark") return;
          const last = doc.lineAt(underline.from).number;
          for (let n = doc.lineAt(node.from).number; n < last; n++) {
            addLine(n, `cm-md-h${setext[1]}`);
          }
          return;
        }

        if (name === "ListMark") {
          if (bareMark(state, node.node)) return;
          // the mark, its spaces, and any `>`s straight after (`- > a quote`
          // in the item): all markup, all hidden under the marker
          let end = skipSpaces(state, node.to);
          while (doc.sliceString(end, end + 1) === ">") end = skipSpaces(state, end + 1);
          const char = doc.sliceString(node.from, node.to);
          const bullet = ["-", "+", "*"].includes(char);
          const task = node.node.nextSibling?.firstChild;
          const isTask =
            bullet &&
            task?.name === "TaskMarker" &&
            doc.sliceString(end, task.from).trim() === "";
          const shift = markerShift(doc.lineAt(node.from), node.node.parent);
          const selected = selectedOver(
            state,
            node.from,
            isTask && task ? task.to : end
          );
          if (isTask && task) {
            // the checkbox takes the bullet's place: drop the mark, and hang
            // the task marker (which tasks.ts draws as a checkbox).
            if (end > node.from) decos.push(hidden.range(node.from, end));
            decos.push(
              (shift
                ? Decoration.mark({
                    class:
                      "cm-md-hang cm-md-list-marker" +
                      (selected ? MARKER_SELECTED : ""),
                    inclusive: true,
                    attributes: { style: shift },
                  })
                : selected
                  ? selectedTaskMark
                  : taskMark
              ).range(task.from, task.to)
            );
            // the space after the box is hidden, not hung: hung, the caret
            // at the start of the text would be drawn at the end of the hang.
            const after = skipSpaces(state, task.to);
            if (after > task.to) decos.push(hidden.range(task.to, after));
            return;
          }
          if (bullet) {
            decos.push(
              Decoration.replace({
                widget: new Bullet(
                  BULLET_SHAPES[(bulletDepth(node.node) - 1) % BULLET_SHAPES.length],
                  shift,
                  selected
                ),
              }).range(node.from, end)
            );
          } else {
            decos.push(
              Decoration.replace({
                widget: new NumberLabel(
                  renderedNumber(state, node.node),
                  shift,
                  selected
                ),
              }).range(node.from, end)
            );
          }
          return;
        }

        if (name === "FencedCode" || name === "CodeBlock") {
          // every line in the code font, whether or not its language
          // highlighter tags each word: untagged text would otherwise take
          // the body font.
          const first = doc.lineAt(node.from).number;
          const last = doc.lineAt(node.to).number;
          for (let n = first; n <= last; n++) {
            addLine(n, "cm-md-code");
            if (n === first) addLine(n, "cm-md-code-first");
            if (n === last) addLine(n, "cm-md-code-last");
          }
          return false;
        }

        if (name === "HorizontalRule") {
          // a rule across the text; the `---` itself only on the caret's line
          const line = doc.lineAt(node.from);
          if (!editing.has(line.number))
            decos.push(
              Decoration.replace({ widget: new Rule() }).range(node.from, node.to)
            );
          return false;
        }

        if (name === "InlineCode") {
          // one tinted pill for the whole thing, backticks and all
          decos.push(inlineCode.range(node.from, node.to));
          return false;
        }

        // (quotes and list items were laid out above, from layout(); their
        // `>`s and indentation are hidden there.)
      },
    });
  }

  for (const [n, classes] of lineClasses) {
    const style = lineStyles.get(n);
    decos.push(
      Decoration.line({
        class: classes.join(" "),
        ...(style ? { attributes: { style: style.join("; ") } } : {}),
      }).range(doc.line(n).from)
    );
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
    // in the text's own ems (resolved where used): a checkbox is about as
    // tall as the text, and its centre is the column every list marker and
    // quote bar is centred on; the text starts a gap after it
    "--markdown-marker-size": "0.9em",
    "--markdown-marker-centre": "calc(var(--markdown-marker-size) / 2)",
    "--markdown-list-indent": "1.45em",
    // quote text lines up with list text
    "--markdown-quote-indent": "var(--markdown-list-indent)",
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
  // a marker over selected markup, tinted as the selected text beside it is
  // (themes/markdown.ts sets the same colours on the text's ::selection)
  ".cm-md-list-marker-selected": {
    background: "var(--text-editor-selection-fill, Highlight)",
  },
  ".cm-md-list-marker-selected.cm-md-hang-number": {
    color: "var(--text-editor-selection-line, HighlightText)",
  },
  // a heading label over selected `#`s: picked out as its level menu picks it
  // out (headings.ts), in the selection's colours
  ".cm-md-heading-label-selected .cm-md-heading-text": {
    borderRadius: "4px",
    padding: "0 0.2em",
    marginRight: "-0.2em",
    background: "var(--text-editor-selection-fill, Highlight)",
    color: "var(--text-editor-selection-line, HighlightText)",
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
  // a line in quotes and lists: padded one indent per container it's in
  // (CodeMirror's own 6px first; --md-inset from margin.ts's layout)
  ".cm-md-inset": {
    paddingLeft: "calc(6px + var(--md-inset))",
  },
  // its marker, in that padding: from the start of the indent, not hung
  // right; at the text's size, sitting on its line like text does, so a
  // number shares the text's baseline and a box or dot (vertical-align:
  // middle) is centred on it
  ".cm-md-list-marker": {
    display: "inline-block",
    boxSizing: "border-box",
    width: "auto",
    minWidth: "var(--markdown-list-indent)",
    marginLeft: "calc(-1 * var(--markdown-list-indent))",
    paddingRight: "0",
    fontSize: "inherit",
    textAlign: "left",
  },
  ".cm-md-list-marker.cm-md-hang-number": {
    color: "var(--text-editor-line-offset-40, inherit)",
  },
  ".cm-md-heading-level": {
    fontSize: "0.75em",
    verticalAlign: "-0.15em",
  },
  ".cm-md-hang .cm-bullet": {
    "--dot": "0.4em",
    display: "inline-block",
    width: "var(--dot)",
    height: "var(--dot)",
    // centred on the column a checkbox's centre is on
    marginLeft: "calc(var(--markdown-marker-centre) - var(--dot) / 2)",
    verticalAlign: "middle",
    borderRadius: "50%",
    boxSizing: "border-box",
    // theming's list marker colour (shared with the quote bar)
    "--bullet-colour":
      "var(--syntax-list-marker, var(--text-editor-primary-text, currentColor))",
    background: "var(--bullet-colour)",
  },
  // second level: a ring
  ".cm-md-hang .cm-bullet-circle": {
    background: "transparent",
    border: "max(1.5px, 0.09em) solid var(--bullet-colour)",
  },
  // third: a diamond, a touch smaller so it weighs the same as the dot
  ".cm-md-hang .cm-bullet-diamond": {
    "--dot": "0.34em",
    borderRadius: "1px",
    transform: "rotate(45deg)",
  },
  ".cm-md-hang .cm-task": {
    margin: "0",
  },
  // a quote's lines hold its bars (QuoteBars), placed against the line
  ".cm-md-quote": {
    position: "relative",
  },
  // code sits on a faint step up the editor's fill ramp: inline, a pill;
  // a block, a rounded panel laid out like a callout: its left edge where a
  // quote's bar would be, its text where a quote's text would start — one
  // indent in from wherever the block is (in a list item, a quote, …)
  ".cm-md-code": {
    position: "relative",
    // a stacking context, so the tint drawn behind the text (z-index -1)
    // stays above the editor's own background.
    isolation: "isolate",
    fontFamily: "var(--text-editor-family-code)",
    paddingLeft:
      "calc(6px + var(--md-inset, 0px) + var(--markdown-quote-indent))",
    paddingRight: zoomed("0.75rem"),
  },
  ".cm-md-code::after": {
    content: '""',
    position: "absolute",
    zIndex: "-1",
    left: "calc(6px + var(--md-inset, 0px) + var(--markdown-marker-centre) - 1.5px)",
    right: "0",
    top: "0",
    bottom: "0",
    background: "var(--text-editor-fill-offset-10, rgb(0 0 0 / 0.04))",
  },
  ".cm-md-code-first": {
    paddingTop: zoomed("0.5rem"),
  },
  ".cm-md-code-first::after": {
    borderTopLeftRadius: "6px",
    borderTopRightRadius: "6px",
  },
  ".cm-md-code-last": {
    paddingBottom: zoomed("0.5rem"),
  },
  ".cm-md-code-last::after": {
    borderBottomLeftRadius: "6px",
    borderBottomRightRadius: "6px",
  },
  ".cm-md-hr": {
    display: "inline-block",
    width: "100%",
    verticalAlign: "middle",
    borderTop:
      "var(--studio-border-width, 1px) var(--studio-border-style, solid) var(--text-editor-fill-offset-40, rgb(0 0 0 / 0.15))",
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
  ".cm-md-quote-bar.cm-md-callout-bar": {
    background: "var(--md-callout)",
    opacity: "1",
  },
  // the tint starts at the callout's own bar (--md-callout-left), wherever
  // the line's text is
  ".cm-md-callout::after": {
    content: '""',
    position: "absolute",
    zIndex: "-1",
    left: "calc(6px + var(--md-callout-left, 0px) + var(--markdown-marker-centre) - 1.5px)",
    right: "0",
    top: "0",
    bottom: "0",
    background: "var(--md-callout-fill)",
  },
  ".cm-md-callout.cm-md-callout-first": {
    paddingTop: zoomed("0.5rem"),
  },
  ".cm-md-callout.cm-md-callout-last": {
    paddingBottom: zoomed("0.5rem"),
  },
  ".cm-md-callout.cm-md-callout-first::after": {
    borderTopRightRadius: "6px",
  },
  ".cm-md-callout.cm-md-callout-last::after": {
    borderBottomRightRadius: "6px",
  },
  // a callout's bar runs the whole height of its tint
  ".cm-md-quote-bar.cm-md-callout-bar.cm-md-quote-bar-first": {
    top: "0",
    borderTopRightRadius: "0",
  },
  ".cm-md-quote-bar.cm-md-callout-bar.cm-md-quote-bar-last": {
    bottom: "0",
    borderBottomRightRadius: "0",
  },
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
  // empty, in the flow: holds the bars without taking room on the line
  ".cm-md-quote-bars": {
    display: "inline",
  },
  // a bar down a quote's indent; its widget's inline style says how far in
  // (`left`, the indents of what the quote's inside), and this centres it on
  // that indent's marker column
  ".cm-md-quote-bar": {
    position: "absolute",
    marginLeft: "calc(var(--markdown-marker-centre) - 1.5px)",
    top: "0",
    bottom: "0",
    width: "3px",
    // the same colour as the bullets
    background:
      "var(--syntax-quote-bar, var(--syntax-list-marker, var(--text-editor-primary-text, currentColor)))",
    opacity: "0.6",
    pointerEvents: "none",
  },
  // a quote's indent under a selection, bar to text (see QuoteBars), in the
  // colour of the selected text beside it; full height, so a run of selected
  // lines joins up
  ".cm-md-quote-selected": {
    position: "absolute",
    top: "0",
    bottom: "0",
    width: "var(--markdown-quote-indent)",
    background: "var(--text-editor-selection-fill, Highlight)",
    pointerEvents: "none",
  },
  ".cm-md-quote-bar-first": {
    top: "0.2em",
    borderTopLeftRadius: "3px",
    borderTopRightRadius: "3px",
  },
  ".cm-md-quote-bar-last": {
    bottom: "0.2em",
    borderBottomLeftRadius: "3px",
    borderBottomRightRadius: "3px",
  },
});

export const margin = [marginPlugin, marginTheme];
