import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  Prec,
  type Line,
  type StateCommand,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * A line's block prefix: the markup at its start that says what kind of block
 * it is — `# `, `> `, `- `, `1. `, `- [ ] `, and any mix and indentation of
 * those (`> - [ ] `). margin.ts never shows it as text: it draws a label, a
 * dot, a number, a checkbox or a bar in its place. So, as in lush and rich:
 *
 *  - the caret never goes inside it (moving left out of the text goes on to
 *    the line above, rather than sticking);
 *  - Backspace at the start of the text takes off the innermost marker
 *    (`- [ ] x` → `- x` → `x`; `# x` → `x`; `> x` → `x`);
 *  - Delete at the end of the line before pulls in the text, not the markup;
 *  - typing a marker at the start of the text replaces the line's own
 *    (`1. ` then `2. ` is a `2.` item, not a list inside a list; `## ` on a
 *    heading changes its level).
 */

export type Prefix = {
  from: number;
  to: number;
  /** names of the marker nodes, outermost first */
  marks: string[];
  /** where each marker starts; Backspace deletes from the last one to `to` */
  starts: number[];
};

const MARKS = new Set(["QuoteMark", "ListMark", "HeaderMark", "TaskMarker"]);

function skipSpaces(state: EditorState, pos: number, end: number) {
  while (pos < end && /[ \t]/.test(state.doc.sliceString(pos, pos + 1))) pos++;
  return pos;
}

/** The block prefix at the start of `line`, or null if it has none. */
export function blockPrefix(state: EditorState, line: Line): Prefix | null {
  const tree = syntaxTree(state);
  const marks: string[] = [];
  const starts: number[] = [];
  let pos = line.from;
  for (;;) {
    const at = skipSpaces(state, pos, line.to);
    const node = tree.resolveInner(at, 1);
    if (!MARKS.has(node.name) || node.from !== at || node.to <= at) break;
    // a closing `##` or a `>` mid-line isn't a prefix.
    if (doc(state, pos, at).trim() !== "") break;
    marks.push(node.name);
    starts.push(at);
    pos = node.to;
  }
  if (!marks.length) return null;
  return { from: line.from, to: skipSpaces(state, pos, line.to), marks, starts };
}

const doc = (state: EditorState, from: number, to: number) =>
  state.doc.sliceString(from, to);

/** Keep empty cursors out of block prefixes. */
const keepOut = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr;
  const { state } = tr;
  const before = tr.startState.selection;
  let moved = false;
  const ranges = tr.selection.ranges.map((r, i) => {
    if (!r.empty) return r;
    const line = state.doc.lineAt(r.head);
    const prefix = blockPrefix(state, line);
    if (!prefix || r.head >= prefix.to) return r;
    const old = before.ranges[i] ?? before.main;
    const leaving =
      !tr.docChanged && old.empty && old.head === prefix.to && line.from > 0;
    moved = true;
    return EditorSelection.cursor(leaving ? line.from - 1 : prefix.to);
  });
  if (!moved) return tr;
  return [
    tr,
    {
      selection: EditorSelection.create(ranges, tr.selection.mainIndex),
      sequential: true,
    },
  ];
});

/** The prefix whose end the only, empty, cursor sits at. */
function atTextStart(state: EditorState) {
  const sel = state.selection;
  if (sel.ranges.length !== 1 || !sel.main.empty) return null;
  const prefix = blockPrefix(state, state.doc.lineAt(sel.main.head));
  return prefix && sel.main.head === prefix.to ? prefix : null;
}

const backspace: StateCommand = ({ state, dispatch }) => {
  const prefix = atTextStart(state);
  if (!prefix) return false;
  dispatch(
    state.update({
      changes: { from: prefix.starts.at(-1)!, to: prefix.to },
      selection: EditorSelection.cursor(prefix.starts.at(-1)!),
      userEvent: "delete.backward",
    })
  );
  return true;
};

const deleteForward: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection;
  if (sel.ranges.length !== 1 || !sel.main.empty) return false;
  const line = state.doc.lineAt(sel.main.head);
  if (sel.main.head !== line.to || line.number >= state.doc.lines) return false;
  const prefix = blockPrefix(state, state.doc.line(line.number + 1));
  if (!prefix) return false;
  dispatch(
    state.update({
      changes: { from: line.to, to: prefix.to },
      userEvent: "delete.forward",
    })
  );
  return true;
};

const inCode = (state: EditorState, pos: number) => {
  for (
    let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null =
      syntaxTree(state).resolveInner(pos, -1);
    n;
    n = n.parent
  ) {
    if (/^(FencedCode|CodeBlock|CodeText|InlineCode)$/.test(n.name)) return true;
  }
  return false;
};

/** A marker that, typed at the start of a list item, replaces its own. */
const LIST_OR_HEADING = /^(\d{1,9}[.)]|[-*+]|#{1,6})$/;
/** On a heading only `#`s do: `## 1. Introduction` is a heading. */
const HEADING = /^#{1,6}$/;

/**
 * Typing a space after a marker at the start of a list item's or heading's
 * text swaps the line's innermost marker for the typed one. Quotes are left
 * alone: `> - ` is a list in a quote, which is what you meant.
 */
const replaceMarker = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== " " || from !== to) return false;
  const { state } = view;
  const line = state.doc.lineAt(from);
  const prefix = blockPrefix(state, line);
  if (!prefix || inCode(state, from)) return false;
  const { marks, starts } = prefix;
  let typed = doc(state, prefix.to, from);
  let mine = marks.length - 1; // the marker the typed one replaces
  if (!typed && prefix.to === from && marks.length > 1) {
    // the parser may already have taken what was typed for a marker of its
    // own (`1. 2.` is a list in a list; `# #` a heading's closing mark).
    typed = doc(state, starts[mine], from);
    mine--;
  }
  if (!typed || marks[mine] === "QuoteMark") return false;
  // a task's box goes with its bullet.
  if (marks[mine] === "TaskMarker" && marks[mine - 1] === "ListMark") mine--;
  const ok = marks[mine] === "HeaderMark" ? HEADING : LIST_OR_HEADING;
  if (!ok.test(typed)) return false;
  view.dispatch({
    changes: { from: starts[mine], to: from, insert: typed + " " },
    selection: EditorSelection.cursor(starts[mine] + typed.length + 1),
    userEvent: "input.type",
  });
  return true;
});

export const prefixes = [
  keepOut,
  replaceMarker,
  // above lang-markdown's own (Prec.high) Backspace.
  Prec.highest(
    keymap.of([
      { key: "Backspace", run: backspace },
      { key: "Delete", run: deleteForward },
    ])
  ),
];
