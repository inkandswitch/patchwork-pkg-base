import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { indentMore } from "@codemirror/commands";
import {
  type ChangeSpec,
  type EditorState,
  type Range,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { type MenuItem as Item, menuTheme, openMenu } from "./menu.ts";
import { selectedOver } from "./selected.ts";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type Command,
  type DecorationSet,
} from "@codemirror/view";

/**
 * List tidying, from a menu on a list's margin marker (the number, bullet or
 * checkbox that margin.ts hangs there). Right-clicking the text itself keeps
 * the browser's own menu, with its spelling and clipboard items.
 *
 *  - Fix numbering: rewrite an ordered list's numbers to the ones it renders
 *    as (margin.ts already shows those; this makes the source agree).
 *  - Move done to bottom / Clear done: for task lists.
 *  - Hide done / Show done: folds every done task away, in this editor only.
 */

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/** The innermost list holding `pos`. */
export function listAt(state: EditorState, pos: number): SyntaxNode | null {
  for (
    let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    n;
    n = n.parent
  ) {
    if (n.name === "BulletList" || n.name === "OrderedList") return n;
  }
  return null;
}

export const items = (list: SyntaxNode) => list.getChildren("ListItem");

/** `true`/`false` for a ticked/open task item, `null` for a plain item. */
function done(state: EditorState, item: SyntaxNode): boolean | null {
  const marker = item.getChild("Task")?.getChild("TaskMarker");
  if (!marker) return null;
  return state.doc.sliceString(marker.from + 1, marker.to - 1).trim() !== "";
}

/** An item as written: from the start of its first line (so its indent comes
 *  with it) to the end of its last nested line. */
export const startOf = (state: EditorState, item: SyntaxNode) =>
  state.doc.lineAt(item.from).from;
const textOf = (state: EditorState, item: SyntaxNode) =>
  state.doc.sliceString(startOf(state, item), item.to);

/**
 * Changes that delete `gone` (indexes into `all`) along with the line breaks
 * between them, without overlapping: a run of deleted items takes the gap up
 * to the next kept item, or, at the end of the list, the gap after the kept
 * item before it.
 */
function deleteItems(
  state: EditorState,
  all: SyntaxNode[],
  gone: Set<number>
): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  for (let i = 0; i < all.length; ) {
    if (!gone.has(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < all.length && gone.has(j + 1)) j++;
    if (j + 1 < all.length) {
      changes.push({ from: startOf(state, all[i]), to: startOf(state, all[j + 1]) });
    } else if (i > 0) {
      changes.push({ from: all[i - 1].to, to: all[j].to });
    } else {
      changes.push({ from: startOf(state, all[i]), to: all[j].to });
    }
    i = j + 1;
  }
  return changes;
}

/** Rewrite an ordered list's numbers to count up from its first. */
export function renumber(state: EditorState, list: SyntaxNode): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  const all = items(list);
  const firstMark = all[0]?.getChild("ListMark");
  if (!firstMark) return changes;
  // a list inside a list item starts again from 1; a top-level one keeps its
  // first number (`5.` there is usually on purpose).
  const nested = list.parent?.name === "ListItem";
  const start = nested
    ? 1
    : parseInt(state.doc.sliceString(firstMark.from, firstMark.to), 10) || 0;
  all.forEach((item, i) => {
    const mark = item.getChild("ListMark");
    if (!mark) return;
    const text = state.doc.sliceString(mark.from, mark.to);
    const want = `${start + i}${text.slice(-1)}`;
    if (want === text) return;
    changes.push({ from: mark.from, to: mark.to, insert: want });
    // the item's later lines are indented to its text; keep them there, or
    // `9.`→`10.` would un-nest whatever's under it.
    const shift = want.length - text.length;
    const first = state.doc.lineAt(item.from).number;
    const last = state.doc.lineAt(item.to).number;
    for (let n = first + 1; n <= last; n++) {
      const line = state.doc.line(n);
      if (shift > 0) {
        if (line.length) changes.push({ from: line.from, insert: " ".repeat(shift) });
      } else {
        const spaces = /^ */.exec(line.text)![0].length;
        const cut = Math.min(spaces, -shift);
        if (cut) changes.push({ from: line.from, to: line.from + cut });
      }
    }
  });
  return changes;
}

export function needsRenumber(state: EditorState, list: SyntaxNode) {
  return list.name === "OrderedList" && renumber(state, list).length > 0;
}

/** Remove a list's done tasks. */
export function clearDone(state: EditorState, list: SyntaxNode): ChangeSpec[] {
  const all = items(list);
  const gone = new Set(all.flatMap((it, i) => (done(state, it) ? [i] : [])));
  return deleteItems(state, all, gone);
}

/**
 * Move a list's done tasks below its open ones, keeping each group's order.
 * Only the done tasks above the last open one move; it's the minimal edit, so
 * someone typing elsewhere in the list keeps their place.
 */
export function moveDoneDown(
  state: EditorState,
  list: SyntaxNode
): ChangeSpec[] {
  const all = items(list);
  let lastOpen = -1;
  all.forEach((it, i) => {
    if (done(state, it) === false || done(state, it) === null) lastOpen = i;
  });
  const moving = new Set<number>();
  for (let i = 0; i < lastOpen; i++) if (done(state, all[i])) moving.add(i);
  if (!moving.size) return [];
  const texts = [...moving].map((i) => textOf(state, all[i]));
  return [
    ...deleteItems(state, all, moving),
    { from: all[lastOpen].to, insert: "\n" + texts.join("\n") },
  ];
}

const countDone = (state: EditorState, list: SyntaxNode) =>
  items(list).filter((it) => done(state, it)).length;

/**
 * Tab on an ordered item indents it as usual, and if that makes it the first
 * item of a new list inside the one above, numbers it 1 — `4.` tabbed in
 * under `3.` is the start of a sub-list, not its fourth item.
 */
/** The first non-space on a line: where its list marker is, if any. */
const textStart = (line: { from: number; text: string }) =>
  line.from + /^\s*/.exec(line.text)![0].length;

const tabInOrderedList: Command = (view) => {
  const before = view.state;
  const line = before.doc.lineAt(before.selection.main.head);
  const was = listAt(before, textStart(line));
  if (!was || was.name !== "OrderedList" || before.selection.ranges.length !== 1)
    return false;
  if (!indentMore(view)) return false;
  const { state } = view;
  const now = state.doc.lineAt(state.selection.main.head);
  ensureSyntaxTree(state, now.to, 100);
  const list = listAt(state, textStart(now));
  const first = list && items(list)[0];
  const mark = first?.getChild("ListMark");
  if (
    !list ||
    !mark ||
    list.name !== "OrderedList" ||
    list.parent?.name !== "ListItem" ||
    state.doc.lineAt(first!.from).number !== now.number
  )
    return true;
  const text = state.doc.sliceString(mark.from, mark.to);
  const want = `1${text.slice(-1)}`;
  if (text !== want)
    view.dispatch({
      changes: { from: mark.from, to: mark.to, insert: want },
      userEvent: "input.renumber",
    });
  return true;
};

// ---------------------------------------------------------------------------
// hiding done tasks

const setHideDone = StateEffect.define<boolean>();

class HiddenDone extends WidgetType {
  /** `selected`: a selection covers some of the tasks it stands for (which
   *  go with it when it's copied) */
  constructor(readonly count: number, readonly selected = false) {
    super();
  }
  eq(other: HiddenDone) {
    return other.count === this.count && other.selected === this.selected;
  }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "cm-md-hidden-done" + (this.selected ? " cm-md-hidden-done-selected" : "");
    // in a box of its own, to be tinted without the rest of the line
    const label = document.createElement("span");
    label.className = "cm-md-hidden-done-label";
    label.textContent = `${this.count} done`;
    button.append(label);
    button.title = "Show done tasks";
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ effects: setHideDone.of(false) });
    });
    return button;
  }
  ignoreEvent() {
    return true;
  }
}

/**
 * Every run of done tasks folded away, and one "3 done" button at the end of
 * each list that had any (in place of its last run, if that's where it ends).
 */
function hiddenDone(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const hide = Decoration.replace({ block: true });
  // a done item hides its nested items with it; don't hide them twice.
  let hiddenTo = -1;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.from < hiddenTo) return false;
      if (node.name !== "BulletList" && node.name !== "OrderedList") return;
      const all = items(node.node);
      const total = all.filter((it) => done(state, it)).length;
      if (!total) return;
      // the runs of done tasks this list hides, all stood for by one button
      const runs: { from: number; to: number; last: boolean }[] = [];
      for (let i = 0; i < all.length; ) {
        if (!done(state, all[i])) {
          i++;
          continue;
        }
        let j = i;
        while (j + 1 < all.length && done(state, all[j + 1])) j++;
        runs.push({
          from: startOf(state, all[i]),
          to: all[j].to,
          last: j === all.length - 1,
        });
        i = j + 1;
      }
      const button = new HiddenDone(
        total,
        runs.some((r) => selectedOver(state, r.from, r.to))
      );
      for (const run of runs) {
        decos.push(
          (run.last ? Decoration.replace({ block: true, widget: button }) : hide).range(
            run.from,
            run.to
          )
        );
        hiddenTo = Math.max(hiddenTo, run.to);
      }
      const end = all[all.length - 1];
      if (!done(state, end)) {
        decos.push(
          Decoration.widget({ block: true, side: 1, widget: button }).range(end.to)
        );
      }
    },
  });
  return Decoration.set(decos, true);
}

const hideDoneField = StateField.define<{ on: boolean; decos: DecorationSet }>({
  create: () => ({ on: false, decos: Decoration.none }),
  update(value, tr) {
    let on = value.on;
    for (const e of tr.effects) if (e.is(setHideDone)) on = e.value;
    if (!on) return { on, decos: Decoration.none };
    // (the selection too: it says which buttons look selected)
    if (
      on === value.on &&
      !tr.docChanged &&
      !tr.selection &&
      syntaxTree(tr.startState) === syntaxTree(tr.state)
    )
      return value;
    return { on, decos: hiddenDone(tr.state) };
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.decos),
    EditorView.atomicRanges.from(f, (v) => () => v.decos),
  ],
});

export const isHidingDone = (state: EditorState) =>
  state.field(hideDoneField, false)?.on ?? false;

// ---------------------------------------------------------------------------
// the menu

/**
 * What the menu offers for the list at `pos`. An ordered list always offers
 * Fix numbering and a task list always offers all its task actions, greyed
 * out when there's nothing for them to do: a menu that only sometimes opens
 * reads as one that doesn't work.
 */
function menuItems(view: EditorView, pos: number): Item[] {
  const { state } = view;
  const list = listAt(state, pos);
  if (!list) return [];
  const apply = (changes: ChangeSpec[], userEvent: string) => () =>
    view.dispatch({ changes, userEvent });
  const out: Item[] = [];
  if (list.name === "OrderedList") {
    const changes = renumber(state, list);
    out.push({
      label: "Fix numbering",
      run: apply(changes, "input.renumber"),
      disabled: !changes.length,
    });
  }
  const hasTasks = items(list).some((it) => done(state, it) !== null);
  if (hasTasks) {
    const n = countDone(state, list);
    const moves = moveDoneDown(state, list);
    out.push({
      label: "Move done to bottom",
      run: apply(moves, "input.move"),
      disabled: !moves.length,
    });
    out.push({
      label: n ? `Clear done (${n})` : "Clear done",
      run: apply(clearDone(state, list), "delete.clear-done"),
      disabled: !n,
    });
    const hiding = isHidingDone(state);
    out.push({
      label: hiding ? "Show done" : "Hide done",
      run: () => view.dispatch({ effects: setHideDone.of(!hiding) }),
    });
  }
  return out;
}

// a plain listener, not `eventHandlers`: the markers are mostly widgets, and
// CodeMirror doesn't pass events inside widgets on to its handlers.
const menuPlugin = ViewPlugin.fromClass(
  class {
    close: (() => void) | null = null;
    constructor(readonly view: EditorView) {
      view.contentDOM.addEventListener("contextmenu", this.open);
    }
    open = (event: MouseEvent) => {
      const { view } = this;
      const target = event.target as HTMLElement | null;
      const marker = target?.closest(".cm-md-hang, .cm-md-hidden-done");
      if (!marker || !view.contentDOM.contains(marker)) return;
      const entries = menuItems(view, view.posAtDOM(marker));
      if (!entries.length) return;
      event.preventDefault();
      this.close?.();
      this.close = openMenu(view, event.clientX, event.clientY, entries);
    };
    destroy() {
      this.view.contentDOM.removeEventListener("contextmenu", this.open);
      this.close?.();
    }
  }
);

const listsTheme = EditorView.baseTheme({
  ".cm-md-hidden-done": {
    all: "unset",
    display: "block",
    paddingInline: "6px 2px",
    fontSize: "0.8rem",
    color: "var(--text-editor-line-offset-40, #999)",
    cursor: "var(--studio-cursor-pointer, pointer)",
  },
  ".cm-md-hidden-done:hover": {
    textDecoration: "underline",
  },
  // standing for selected tasks: tinted as the selected text around it is
  ".cm-md-hidden-done-selected .cm-md-hidden-done-label": {
    background: "var(--text-editor-selection-fill, Highlight)",
    color: "var(--text-editor-selection-line, HighlightText)",
  },
});

export const lists = [
  hideDoneField,
  menuPlugin,
  menuTheme,
  listsTheme,
  // ahead of indentWithTab in the main keymap
  Prec.high(keymap.of([{ key: "Tab", run: tabInOrderedList }])),
];
