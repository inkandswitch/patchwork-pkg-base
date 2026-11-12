import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownExtensions } from "./markdown";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeView(doc: string, at: number) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdownExtensions()],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
  view.dispatch({});
  return view;
}

const head = (view: EditorView) => view.state.selection.main.head;
const text = (view: EditorView) => view.state.doc.toString();
const press = (view: EditorView, key: string) =>
  runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");

/** type `chars` one at a time, the way the keyboard would */
function type(view: EditorView, chars: string) {
  for (const ch of chars) {
    const { from, to } = view.state.selection.main;
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((h) => h(view, from, to, ch, () => view.state.update({ changes: { from, to, insert: ch } })));
    if (!handled)
      view.dispatch({
        changes: { from, to, insert: ch },
        selection: { anchor: from + ch.length },
        userEvent: "input.type",
      });
    ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
  }
}

describe("block prefixes", () => {
  it("keeps the caret out of list, task and quote markup", () => {
    for (const [doc, after] of [
      ["- item", "- "],
      ["10. item", "10. "],
      ["- [ ] task", "- [ ] "],
      ["> quote", "> "],
      ["> - both", "> - "],
      ["- a\n    - nested", "    - "],
    ]) {
      const view = makeView(doc, doc.length);
      const line = view.state.doc.lineAt(doc.length);
      view.dispatch({ selection: { anchor: line.from } });
      expect(head(view) - line.from, doc).toBe(after.length);
    }
  });

  it("backspace at the start of the text takes off the innermost marker", () => {
    for (const [doc, then] of [
      ["# Title", "Title"],
      ["> quote", "quote"],
      ["- [ ] task", "- task"],
      ["- item", "item"],
      ["> - both", "> both"],
    ]) {
      const prefix = doc.length - doc.split(" ").pop()!.length;
      const view = makeView(doc, prefix);
      press(view, "Backspace");
      expect(text(view), doc).toBe(then);
    }
  });

  it("typing a list marker at the start of an item replaces its own", () => {
    const view = makeView("1. go", 3);
    type(view, "2. ");
    expect(text(view)).toBe("2. go");
    type(view, "3. 4. ");
    expect(text(view)).toBe("4. go");
    type(view, "- ");
    expect(text(view)).toBe("- go");
    expect(head(view)).toBe(2);
  });

  it("replaces a task's bullet and box together", () => {
    const view = makeView("- [ ] go", 6);
    type(view, "1. ");
    expect(text(view)).toBe("1. go");
  });

  it("changes a heading's level by typing #s, but leaves numbers in its text", () => {
    const view = makeView("# Title", 2);
    type(view, "## ");
    expect(text(view)).toBe("## Title");
    type(view, "1. ");
    expect(text(view)).toBe("## 1. Title");
  });

  it("leaves a list typed into a quote alone", () => {
    const view = makeView("> go", 2);
    type(view, "- ");
    expect(text(view)).toBe("> - go");
  });

  it("delete before a list item pulls in its text, not its marker", () => {
    const view = makeView("para\n- item", 4);
    press(view, "Delete");
    expect(text(view)).toBe("paraitem");
  });
});
