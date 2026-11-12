import { syntaxTree } from "@codemirror/language";
import { moveLineDown, moveLineUp } from "@codemirror/commands";
import {
  EditorSelection,
  Prec,
  type EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  keymap,
  type Command,
} from "@codemirror/view";
import { items, startOf } from "./lists.ts";

/**
 * Moving list items, as in Apple Notes:
 *
 *  - Ctrl-Cmd-↑/↓ (Ctrl-Alt-↑/↓ off a Mac) moves the item the caret is in
 *    past its neighbour, nested items and all. Outside a list it moves the
 *    line, as Notes moves a paragraph.
 *  - Dragging an item's dot or number moves it among its siblings: a line
 *    shows where it'll land; Escape puts it back.
 *
 * The list's markers stay in their places — the items move between them — so
 * moving a numbered list's first item doesn't renumber the list from the
 * number the item was typed with.
 */

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/** The innermost list item holding `pos`, and the list it's in. */
function itemAt(state: EditorState, pos: number) {
  for (
    let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    n;
    n = n.parent
  ) {
    if (n.name === "ListItem" && n.parent) return { item: n, list: n.parent };
  }
  return null;
}

/**
 * Move a list's item `from` to be its item `to`. Returns the transaction,
 * and where in the new document a position inside the moved item lands.
 */
export function moveItem(
  state: EditorState,
  list: SyntaxNode,
  from: number,
  to: number
): { spec: TransactionSpec; map: (pos: number) => number } | null {
  const all = items(list);
  if (from === to || to < 0 || to >= all.length) return null;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const doc = state.doc;

  // each item in the span: its marker (with its indent) and the rest of it
  const parts = all.slice(lo, hi + 1).map((item) => {
    const start = startOf(state, item);
    const mark = item.getChild("ListMark");
    const markEnd = mark ? mark.to : start;
    return {
      start,
      head: doc.sliceString(start, markEnd),
      body: doc.sliceString(markEnd, item.to),
      end: item.to,
    };
  });
  // and what's between them (a line break, or a blank line too)
  const gaps = parts.slice(1).map((p, i) => doc.sliceString(parts[i].end, p.start));

  const order = parts.map((_, i) => i);
  const [moved] = order.splice(from - lo, 1);
  order.splice(to - lo, 0, moved);

  let text = "";
  let movedAt = 0;
  order.forEach((i, slot) => {
    if (slot > 0) text += gaps[slot - 1];
    if (i === moved) movedAt = text.length;
    // the item takes the marker of the slot it lands in
    text += parts[slot].head + parts[i].body;
  });

  const spanFrom = parts[0].start;
  const old = parts[moved];
  const newHead = parts[to - lo].head;
  return {
    spec: {
      changes: { from: spanFrom, to: parts[parts.length - 1].end, insert: text },
      userEvent: "move.list-item",
      scrollIntoView: true,
    },
    map: (pos) => {
      const offset = pos - old.start;
      const shift = offset >= old.head.length ? newHead.length - old.head.length : 0;
      return spanFrom + movedAt + offset + shift;
    },
  };
}

const moveBy =
  (step: -1 | 1, fallback: Command): Command =>
  (view) => {
    const { state } = view;
    const sel = state.selection;
    if (sel.ranges.length !== 1) return fallback(view);
    const found = itemAt(state, sel.main.head);
    if (!found) return fallback(view);
    const all = items(found.list);
    const index = all.findIndex((i) => i.from === found.item.from);
    const moved = moveItem(state, found.list, index, index + step);
    // at the end of its list it stays put (and the keys do nothing else)
    if (!moved) return true;
    view.dispatch({
      ...moved.spec,
      selection: EditorSelection.range(
        moved.map(sel.main.anchor),
        moved.map(sel.main.head)
      ),
    });
    return true;
  };

export const moveItemUp = moveBy(-1, moveLineUp);
export const moveItemDown = moveBy(1, moveLineDown);

const moveKeys = Prec.high(
  keymap.of([
    { key: "Ctrl-Alt-ArrowUp", mac: "Ctrl-Cmd-ArrowUp", run: moveItemUp, preventDefault: true },
    { key: "Ctrl-Alt-ArrowDown", mac: "Ctrl-Cmd-ArrowDown", run: moveItemDown, preventDefault: true },
  ])
);

// ---------------------------------------------------------------------------
// dragging

/** The client-space top and bottom of a list item (its first and last lines). */
function itemBox(view: EditorView, state: EditorState, item: SyntaxNode) {
  const top = view.lineBlockAt(startOf(state, item)).top + view.documentTop;
  const bottom = view.lineBlockAt(item.to).bottom + view.documentTop;
  return { top, bottom };
}

class Drag {
  line: HTMLDivElement;
  target: number | null = null;
  constructor(
    readonly view: EditorView,
    readonly list: SyntaxNode,
    readonly index: number,
    readonly marker: HTMLElement
  ) {
    this.line = document.createElement("div");
    this.line.className = "cm-md-drop-line";
    view.dom.appendChild(this.line);
    marker.classList.add("cm-md-dragging");
    view.dom.classList.add("cm-md-drag-active");
  }

  /** Where the pointer at `y` would put the item, and draw the line there. */
  track(y: number) {
    const { view, list } = this;
    const all = items(list);
    let slot = all.length;
    for (let i = 0; i < all.length; i++) {
      const box = itemBox(view, view.state, all[i]);
      if (y < (box.top + box.bottom) / 2) {
        slot = i;
        break;
      }
    }
    // a slot is a gap between items; landing next to itself is no move
    const to = slot > this.index ? slot - 1 : slot;
    this.target = to === this.index ? null : to;
    const edge =
      slot < all.length
        ? itemBox(view, view.state, all[slot]).top
        : itemBox(view, view.state, all[all.length - 1]).bottom;
    const textLeft = view.coordsAtPos(startOf(view.state, all[0]), 1)?.left;
    const content = view.contentDOM.getBoundingClientRect();
    const host = view.dom.getBoundingClientRect();
    this.line.style.top = `${edge - host.top + view.dom.scrollTop - 1}px`;
    this.line.style.left = `${(textLeft ?? content.left) - host.left}px`;
    this.line.style.width = `${content.right - (textLeft ?? content.left) - 16}px`;
    this.line.style.visibility = this.target === null ? "hidden" : "visible";
  }

  drop() {
    const { view, list, index, target } = this;
    this.end();
    if (target === null) return;
    const moved = moveItem(view.state, list, index, target);
    if (moved) view.dispatch(moved.spec);
  }

  end() {
    this.line.remove();
    this.marker.classList.remove("cm-md-dragging");
    this.view.dom.classList.remove("cm-md-drag-active");
  }
}

/** Press on a bullet or number, move a few pixels, and it's a drag. */
const dragPlugin = ViewPlugin.fromClass(
  class {
    drag: Drag | null = null;
    constructor(readonly view: EditorView) {
      view.contentDOM.addEventListener("pointerdown", this.down);
    }
    down = (event: PointerEvent) => {
      if (event.button !== 0 || !this.view.state.facet(EditorView.editable)) return;
      const marker = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".cm-md-list-marker"
      );
      // a checkbox is for ticking; dots and numbers are the handles
      if (!marker || marker.querySelector(".cm-task")) return;
      const { view } = this;
      const found = itemAt(view.state, view.posAtDOM(marker) + 1);
      if (!found) return;
      const index = items(found.list).findIndex((i) => i.from === found.item.from);
      event.preventDefault();
      const startY = event.clientY;
      const win = view.win;
      const move = (e: PointerEvent) => {
        if (!this.drag) {
          if (Math.abs(e.clientY - startY) < 4) return;
          this.drag = new Drag(view, found.list, index, marker);
        }
        this.drag.track(e.clientY);
      };
      const finish = (e: Event) => {
        win.removeEventListener("pointermove", move, true);
        win.removeEventListener("pointerup", finish, true);
        win.removeEventListener("keydown", escape, true);
        const drag = this.drag;
        this.drag = null;
        if (!drag) return;
        if (e.type === "pointerup") drag.drop();
        else drag.end();
      };
      const escape = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        finish(e);
      };
      win.addEventListener("pointermove", move, true);
      win.addEventListener("pointerup", finish, true);
      win.addEventListener("keydown", escape, true);
    };
    destroy() {
      this.view.contentDOM.removeEventListener("pointerdown", this.down);
      this.drag?.end();
    }
  }
);

const moveTheme = EditorView.baseTheme({
  ".cm-md-list-marker:not(:has(.cm-task))": {
    cursor: "grab",
  },
  ".cm-md-drag-active, .cm-md-drag-active *": {
    cursor: "grabbing !important",
  },
  ".cm-md-dragging": {
    opacity: "0.35",
  },
  ".cm-md-drop-line": {
    position: "absolute",
    height: "2px",
    borderRadius: "1px",
    background:
      "var(--syntax-list-marker, var(--text-editor-primary-text, currentColor))",
    pointerEvents: "none",
    zIndex: "10",
  },
});

export const moveListItems = [moveKeys, dragPlugin, moveTheme];
