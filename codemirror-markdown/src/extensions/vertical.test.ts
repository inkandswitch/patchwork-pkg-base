import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, type Command } from "@codemirror/view";
import { vertical } from "./vertical";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeView(doc: string, at: number) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({ doc, selection: EditorSelection.cursor(at) }),
  });
}

/**
 * Stand-ins for cursorLineUp/Down that land somewhere else on the line than
 * where the caret started — what a line changing width does to the real ones
 * (happy-dom has no layout to move by).
 */
const toLine =
  (step: number, column: number): Command =>
  (view) => {
    const { doc } = view.state;
    const n = doc.lineAt(view.state.selection.main.head).number + step;
    if (n < 1 || n > doc.lines) return false;
    const line = doc.line(n);
    view.dispatch({
      selection: { anchor: line.from + Math.min(column, line.length) },
    });
    return true;
  };

const up = vertical(toLine(-1, 3));
const down = vertical(toLine(1, 3));
const head = (view: EditorView) => view.state.selection.main.head;

describe("vertical memory", () => {
  const doc = "first line here\nsecond line, which is long\nthird";

  it("comes back to where it was after Up then Down", () => {
    const at = doc.indexOf("which");
    const view = makeView(doc, at);
    up(view);
    expect(head(view)).toBe(3);
    down(view);
    expect(head(view)).toBe(at);
  });

  it("remembers every line through a run of moves", () => {
    const at = doc.indexOf("which");
    const view = makeView(doc, at);
    down(view);
    up(view);
    up(view);
    down(view);
    expect(head(view)).toBe(at);
  });

  it("forgets after any other move", () => {
    const at = doc.indexOf("which");
    const view = makeView(doc, at);
    up(view);
    view.dispatch({ selection: { anchor: 1 } });
    down(view);
    expect(head(view)).toBe(doc.indexOf("second") + 3);
  });

  it("forgets after an edit", () => {
    const at = doc.indexOf("which");
    const view = makeView(doc, at);
    up(view);
    view.dispatch({ changes: { from: 0, insert: "x" }, selection: { anchor: 4 } });
    down(view);
    expect(head(view)).toBe(doc.indexOf("second") + 1 + 3);
  });
});
