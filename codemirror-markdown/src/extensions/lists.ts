import { syntaxTree } from "@codemirror/language";
import {
  type ChangeSpec,
  type EditorState,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
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

const items = (list: SyntaxNode) => list.getChildren("ListItem");

/** `true`/`false` for a ticked/open task item, `null` for a plain item. */
function done(state: EditorState, item: SyntaxNode): boolean | null {
  const marker = item.getChild("Task")?.getChild("TaskMarker");
  if (!marker) return null;
  return state.doc.sliceString(marker.from + 1, marker.to - 1).trim() !== "";
}

/** An item as written: from the start of its first line (so its indent comes
 *  with it) to the end of its last nested line. */
const startOf = (state: EditorState, item: SyntaxNode) =>
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
  const start =
    parseInt(state.doc.sliceString(firstMark.from, firstMark.to), 10) || 0;
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

// ---------------------------------------------------------------------------
// hiding done tasks

const setHideDone = StateEffect.define<boolean>();

class HiddenDone extends WidgetType {
  constructor(readonly count: number) {
    super();
  }
  eq(other: HiddenDone) {
    return other.count === this.count;
  }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-md-hidden-done";
    button.textContent = `${this.count} done`;
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
      const button = new HiddenDone(total);
      for (let i = 0; i < all.length; ) {
        if (!done(state, all[i])) {
          i++;
          continue;
        }
        let j = i;
        while (j + 1 < all.length && done(state, all[j + 1])) j++;
        const last = j === all.length - 1;
        decos.push(
          (last ? Decoration.replace({ block: true, widget: button }) : hide).range(
            startOf(state, all[i]),
            all[j].to
          )
        );
        hiddenTo = Math.max(hiddenTo, all[j].to);
        i = j + 1;
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
    if (on === value.on && !tr.docChanged && syntaxTree(tr.startState) === syntaxTree(tr.state))
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

type Item = { label: string; run: () => void };

function menuItems(view: EditorView, pos: number): Item[] {
  const { state } = view;
  const list = listAt(state, pos);
  if (!list) return [];
  const apply = (changes: ChangeSpec[], userEvent: string) => () =>
    view.dispatch({ changes, userEvent });
  const out: Item[] = [];
  if (needsRenumber(state, list)) {
    out.push({ label: "Fix numbering", run: apply(renumber(state, list), "input.renumber") });
  }
  const hasTasks = items(list).some((it) => done(state, it) !== null);
  if (hasTasks) {
    const n = countDone(state, list);
    if (moveDoneDown(state, list).length)
      out.push({ label: "Move done to bottom", run: apply(moveDoneDown(state, list), "input.move") });
    if (n)
      out.push({ label: `Clear done (${n})`, run: apply(clearDone(state, list), "delete.clear-done") });
    const hiding = isHidingDone(state);
    out.push({
      label: hiding ? "Show done" : "Hide done",
      run: () => view.dispatch({ effects: setHideDone.of(!hiding) }),
    });
  }
  return out;
}

function openMenu(view: EditorView, x: number, y: number, entries: Item[]) {
  const menu = document.createElement("div");
  menu.className = "cm-md-menu";
  menu.setAttribute("role", "menu");
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const buttons = entries.map(({ label, run }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cm-md-menu-item";
    b.setAttribute("role", "menuitem");
    b.textContent = label;
    b.addEventListener("click", () => {
      close();
      run();
      view.focus();
    });
    return b;
  });
  menu.append(...buttons);

  const outside = (e: Event) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const keys = (e: KeyboardEvent) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      view.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      buttons[(i + step + buttons.length) % buttons.length]?.focus();
    }
  };
  function close() {
    menu.remove();
    window.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("blur", close);
    menu.removeEventListener("keydown", keys);
  }
  window.addEventListener("pointerdown", outside, true);
  window.addEventListener("scroll", close, true);
  window.addEventListener("blur", close);
  menu.addEventListener("keydown", keys);

  view.dom.appendChild(menu);
  // keep it on screen
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = `${Math.max(0, x - r.width)}px`;
  if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(0, y - r.height)}px`;
  buttons[0]?.focus();
  return close;
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
  ".cm-md-menu": {
    position: "fixed",
    zIndex: "var(--studio-layer-popover, 4000)",
    display: "flex",
    flexDirection: "column",
    minWidth: "12rem",
    padding: "4px",
    borderRadius: "6px",
    background: "var(--studio-fill, white)",
    color: "var(--studio-line, black)",
    border:
      "var(--studio-border-width, 1px) var(--studio-border-style, solid) var(--studio-fill-offset-30, #ddd)",
    boxShadow: "var(--studio-shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1))",
    fontFamily: "var(--studio-family-ui, system-ui, sans-serif)",
    fontSize: "0.8rem",
  },
  ".cm-md-menu-item": {
    all: "unset",
    padding: "8px 12px",
    borderRadius: "4px",
    cursor: "var(--studio-cursor-default, default)",
  },
  ".cm-md-menu-item:hover, .cm-md-menu-item:focus-visible": {
    background: "var(--studio-fill-offset-20, #eee)",
  },
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
});

export const lists = [hideDoneField, menuPlugin, listsTheme];
