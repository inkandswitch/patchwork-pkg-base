import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type EditorState,
  Prec,
  type Line,
  type StateCommand,
} from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, type Command } from "@codemirror/view";
import { blockPrefix } from "./prefix.ts";
import { menuTheme, openMenu } from "./menu.ts";

/**
 * Headings behave like the block type they are in lush and rich, not like
 * text that starts with `#`. The `# ` is a block prefix (prefix.ts: never
 * shown, never holds the caret, Backspace at the text's start removes it);
 * this adds what's particular to headings:
 *
 *  - Enter at the start of a heading pushes it down, leaving a line above.
 *  - Mod-Shift-h / Mod-Shift-j make a heading / subheading (lush's keys), and
 *    Mod-Shift-b makes body text. Mod-Alt-1…3 and Mod-Alt-0 do the same.
 *    (lush's Title key, Mod-Shift-t, belongs to the browser.)
 *  - Left at the start of a heading's text, or a click on its H label, opens
 *    a menu of levels by the label: Up and Down to choose, Enter to pick,
 *    Escape or Right to go back to the text, Left again to go on to the line
 *    above as Left otherwise would.
 */

export type HeadingPrefix = { from: number; to: number; level: number };

/** The hidden `# ` at the start of `line`, if the line is an ATX heading. */
export function headingPrefix(
  state: EditorState,
  line: Line
): HeadingPrefix | null {
  for (
    let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null =
      syntaxTree(state).resolveInner(line.from, 1);
    node;
    node = node.parent
  ) {
    const m = /^ATXHeading(\d)$/.exec(node.name);
    if (!m) continue;
    if (state.doc.lineAt(node.from).number !== line.number) return null;
    const mark = node.firstChild;
    if (!mark || mark.name !== "HeaderMark") return null;
    let to = mark.to;
    while (to < line.to && state.doc.sliceString(to, to + 1) === " ") to++;
    return { from: line.from, to, level: Number(m[1]) };
  }
  return null;
}

/** Each line touched by the selection, once. */
function selectedLines(state: EditorState) {
  const seen = new Set<number>();
  const lines: Line[] = [];
  for (const r of state.selection.ranges) {
    for (
      let n = state.doc.lineAt(r.from).number;
      n <= state.doc.lineAt(r.to).number;
      n++
    ) {
      if (seen.has(n)) continue;
      seen.add(n);
      lines.push(state.doc.line(n));
    }
  }
  return lines;
}

/**
 * Make the selected lines headings of `level`, or body text for level 0.
 * If every line is already that level it toggles them back to body text.
 */
export const setHeading =
  (level: number): StateCommand =>
  ({ state, dispatch }) => {
    const lines = selectedLines(state);
    const prefixes = lines.map((line) => headingPrefix(state, line));
    const already =
      level > 0 && prefixes.every((p) => p && p.level === level);
    const target = already ? 0 : level;
    const insert = target ? "#".repeat(target) + " " : "";
    const changes = lines.map((line, i) => {
      const p = prefixes[i];
      return { from: line.from, to: p ? p.to : line.from, insert };
    });
    dispatch(
      state.update({
        changes,
        scrollIntoView: true,
        userEvent: "input.format",
      })
    );
    return true;
  };

/** The prefix of the heading whose text the (only, empty) cursor starts. */
function atHeadingStart(state: EditorState) {
  const sel = state.selection;
  if (sel.ranges.length !== 1 || !sel.main.empty) return null;
  const line = state.doc.lineAt(sel.main.head);
  const prefix = headingPrefix(state, line);
  return prefix && sel.main.head === prefix.to ? prefix : null;
}

const enter: StateCommand = ({ state, dispatch }) => {
  const prefix = atHeadingStart(state);
  if (!prefix) return false;
  const line = state.doc.lineAt(prefix.from);
  // an empty heading: let the usual Enter make a new line below it.
  if (prefix.to >= line.to) return false;
  dispatch(
    state.update({
      changes: { from: line.from, insert: "\n" },
      selection: EditorSelection.cursor(prefix.to + 1),
      scrollIntoView: true,
      userEvent: "input",
    })
  );
  return true;
};

/** The `#`s at the start of the text of the caret's line, if it's a heading:
 *  in a quote or list item too, where headingPrefix doesn't look. */
function caretHeading(state: EditorState) {
  const line = state.doc.lineAt(state.selection.main.head);
  const prefix = blockPrefix(state, line);
  if (!prefix || prefix.marks.at(-1) !== "HeaderMark") return null;
  const from = prefix.starts.at(-1)!;
  const level = state.doc.sliceString(from, prefix.to).trim().length;
  return { line, from, to: prefix.to, level };
}

/** The H label the margin draws for the heading on `line`, if it's drawn. */
function labelOn(view: EditorView, line: Line) {
  const { node } = view.domAtPos(line.from);
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest(".cm-line")?.querySelector<HTMLElement>(".cm-md-heading-label") ?? null;
}

/** Open the level menu for the heading on the caret's line. */
function openLevels(view: EditorView) {
  const heading = caretHeading(view.state);
  if (!heading) return false;
  const label = labelOn(view, heading.line);
  const box = label?.getBoundingClientRect();
  const at = box ?? view.coordsAtPos(heading.to);
  if (!at) return false;
  label?.classList.add("cm-md-heading-label-open");
  label?.setAttribute("aria-expanded", "true");
  const levels = [1, 2, 3, 4, 5, 6].map((level) => ({
    label: `Heading ${level}`,
    checked: level === heading.level,
    // the caret's line again, not the one it opened on: someone else may
    // have moved it while the menu was up.
    run: () => {
      const now = caretHeading(view.state);
      if (!now || now.level === level) return;
      const insert = "#".repeat(level) + " ";
      view.dispatch({
        changes: { from: now.from, to: now.to, insert },
        selection: EditorSelection.cursor(now.from + insert.length),
        userEvent: "input.format",
      });
    },
  }));
  openMenu(view, at.left, at.bottom, levels, {
    focus: heading.level - 1,
    onKey: (event, close) => {
      if (event.key === "ArrowRight") {
        close();
        view.focus();
        return true;
      }
      if (event.key === "ArrowLeft") {
        close();
        view.focus();
        const { line } = caretHeading(view.state) ?? heading;
        if (line.from > 0)
          view.dispatch({ selection: EditorSelection.cursor(line.from - 1) });
        return true;
      }
      return false;
    },
    onClose: () => {
      label?.classList.remove("cm-md-heading-label-open");
      label?.removeAttribute("aria-expanded");
    },
  });
  return true;
}

const leftIntoLabel: Command = (view) => {
  const sel = view.state.selection;
  if (sel.ranges.length !== 1 || !sel.main.empty) return false;
  const heading = caretHeading(view.state);
  if (!heading || sel.main.head !== heading.to) return false;
  return openLevels(view);
};

// a plain listener, not `eventHandlers`: the label is a widget, and
// CodeMirror doesn't pass events inside widgets on to its handlers.
const labelClicks = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      view.contentDOM.addEventListener("mousedown", this.down);
    }
    down = (event: MouseEvent) => {
      const { view } = this;
      if (event.button !== 0) return;
      const label = (event.target as Element | null)?.closest?.(".cm-md-heading-label");
      if (!label || !view.contentDOM.contains(label)) return;
      event.preventDefault();
      const line = view.state.doc.lineAt(view.posAtDOM(label));
      const prefix = blockPrefix(view.state, line);
      if (!prefix) return;
      view.dispatch({ selection: EditorSelection.cursor(prefix.to) });
      openLevels(view);
    };
    destroy() {
      this.view.contentDOM.removeEventListener("mousedown", this.down);
    }
  }
);

const headingsTheme = EditorView.baseTheme({
  ".cm-md-heading-label": {
    cursor: "var(--studio-cursor-pointer, pointer)",
  },
  // picked out while its menu is open, as if it were selected
  ".cm-md-heading-label-open .cm-md-heading-text": {
    borderRadius: "4px",
    padding: "0 0.2em",
    marginRight: "-0.2em",
    background: "var(--text-editor-selection, var(--studio-fill-offset-20, rgb(0 0 0 / 0.08)))",
    color: "var(--text-editor-line, inherit)",
  },
});

export const headings = [
  labelClicks,
  menuTheme,
  headingsTheme,
  // above lang-markdown's own (Prec.high) Enter.
  Prec.highest(
    keymap.of([
      { key: "Enter", run: enter },
      { key: "ArrowLeft", run: leftIntoLabel },
      { key: "Mod-Shift-h", run: setHeading(2), preventDefault: true },
      { key: "Mod-Shift-j", run: setHeading(3), preventDefault: true },
      { key: "Mod-Shift-b", run: setHeading(0), preventDefault: true },
      { key: "Mod-Alt-1", run: setHeading(1), preventDefault: true },
      { key: "Mod-Alt-2", run: setHeading(2), preventDefault: true },
      { key: "Mod-Alt-3", run: setHeading(3), preventDefault: true },
      { key: "Mod-Alt-0", run: setHeading(0), preventDefault: true },
    ])
  ),
];
