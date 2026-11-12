import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  Prec,
  type Line,
  type StateCommand,
} from "@codemirror/state";
import { keymap } from "@codemirror/view";

/**
 * Headings behave like the block type they are in lush and rich, not like
 * text that starts with `#`: the `# ` prefix is never shown (margin.ts draws
 * an H1/H2 label in its place) and the caret never goes inside it.
 *
 *  - Backspace at the start of a heading turns it back into body text.
 *  - Enter at the start of a heading pushes it down, leaving a line above.
 *  - Delete at the end of the line before a heading pulls in its text, not
 *    its `#`s.
 *  - Mod-Shift-h / Mod-Shift-j make a heading / subheading (lush's keys), and
 *    Mod-Shift-b makes body text. Mod-Alt-1…3 and Mod-Alt-0 do the same.
 *    (lush's Title key, Mod-Shift-t, belongs to the browser.)
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

/**
 * Keep empty cursors out of a heading's prefix. Moving left out of the
 * heading's start goes on to the end of the line above, rather than sticking.
 */
const keepOutOfPrefix = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr;
  const { state } = tr;
  const before = tr.startState.selection;
  let moved = false;
  const ranges = tr.selection.ranges.map((r, i) => {
    if (!r.empty) return r;
    const line = state.doc.lineAt(r.head);
    if (r.head >= line.to && line.length > 0) return r;
    const prefix = headingPrefix(state, line);
    if (!prefix || r.head >= prefix.to) return r;
    const old = before.ranges[i] ?? before.main;
    const leaving =
      !tr.docChanged &&
      old.empty &&
      old.head === prefix.to &&
      line.from > 0;
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

const backspace: StateCommand = ({ state, dispatch }) => {
  const prefix = atHeadingStart(state);
  if (!prefix) return false;
  dispatch(
    state.update({
      changes: { from: prefix.from, to: prefix.to },
      selection: EditorSelection.cursor(prefix.from),
      userEvent: "delete.backward",
    })
  );
  return true;
};

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

const deleteForward: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection;
  if (sel.ranges.length !== 1 || !sel.main.empty) return false;
  const line = state.doc.lineAt(sel.main.head);
  if (sel.main.head !== line.to || line.number >= state.doc.lines) return false;
  const prefix = headingPrefix(state, state.doc.line(line.number + 1));
  if (!prefix) return false;
  dispatch(
    state.update({
      changes: { from: line.to, to: prefix.to },
      userEvent: "delete.forward",
    })
  );
  return true;
};

export const headings = [
  keepOutOfPrefix,
  // above lang-markdown's own (Prec.high) Enter and Backspace.
  Prec.highest(
    keymap.of([
      { key: "Backspace", run: backspace },
      { key: "Enter", run: enter },
      { key: "Delete", run: deleteForward },
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
