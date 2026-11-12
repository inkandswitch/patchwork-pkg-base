import { EditorSelection, Prec } from "@codemirror/state";
import { cursorLineDown, cursorLineUp } from "@codemirror/commands";
import { EditorView, keymap, type Command } from "@codemirror/view";

/**
 * Up then Down comes back to where you were.
 *
 * CodeMirror keeps the caret's goal as a pixel column. That's right for plain
 * text, but here leaving a line can change its width — a link the caret was
 * in folds back to just its text, a quote loses its `>` — so the same pixel
 * column lands on a different character on the way back. Through a run of
 * Up/Down presses this remembers the character offset on each line the caret
 * passed through, and goes back to it on returning to that line. Any other
 * move, or an edit, starts afresh.
 */

type Streak = {
  /** line number → where the caret was on it */
  visited: Map<number, number>;
  /** where the last vertical move left the caret; anything else resets */
  head: number;
  doc: EditorView["state"]["doc"];
};

const streaks = new WeakMap<EditorView, Streak>();

export const vertical =
  (move: Command): Command =>
  (view) => {
    const { state } = view;
    const sel = state.selection;
    if (sel.ranges.length !== 1 || !sel.main.empty) return move(view);

    let streak = streaks.get(view);
    if (!streak || streak.head !== sel.main.head || streak.doc !== state.doc) {
      streak = { visited: new Map(), head: sel.main.head, doc: state.doc };
    }
    const from = state.doc.lineAt(sel.main.head).number;
    if (!streak.visited.has(from)) streak.visited.set(from, sel.main.head);

    if (!move(view)) return false;

    const now = view.state.selection.main;
    const to = view.state.doc.lineAt(now.head).number;
    const back = streak.visited.get(to);
    if (back !== undefined && back !== now.head && view.state.doc === streak.doc) {
      view.dispatch({
        selection: EditorSelection.cursor(back),
        scrollIntoView: true,
        userEvent: "select",
      });
    }
    streak.head = view.state.selection.main.head;
    streak.doc = view.state.doc;
    streaks.set(view, streak);
    return true;
  };

// above the default keymap's own Up/Down.
export const verticalMemory = Prec.high(
  keymap.of([
    { key: "ArrowUp", run: vertical(cursorLineUp) },
    { key: "ArrowDown", run: vertical(cursorLineDown) },
    { mac: "Ctrl-p", run: vertical(cursorLineUp) },
    { mac: "Ctrl-n", run: vertical(cursorLineDown) },
  ])
);
