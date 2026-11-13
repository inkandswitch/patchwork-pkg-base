import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { markdownExtensions } from "./markdown";
import { moveItemDown, moveItemUp } from "./move";

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

const text = (v: EditorView) => v.state.doc.toString();
const head = (v: EditorView) => v.state.selection.main.head;
const step = (v: EditorView, cmd: typeof moveItemUp) => {
  cmd(v);
  ensureSyntaxTree(v.state, v.state.doc.length, 10_000);
};

describe("moving list items", () => {
  it("moves an item up and down past its neighbours, caret and all", () => {
    const doc = "- a\n- b\n- c";
    const view = makeView(doc, doc.indexOf("b") + 1);
    step(view, moveItemUp);
    expect(text(view)).toBe("- b\n- a\n- c");
    expect(text(view).slice(head(view) - 1, head(view))).toBe("b");
    step(view, moveItemDown);
    step(view, moveItemDown);
    expect(text(view)).toBe("- a\n- c\n- b");
    expect(text(view).slice(head(view) - 1, head(view))).toBe("b");
  });

  it("stays put at the ends of its list", () => {
    const view = makeView("- a\n- b\n\nafter", 2);
    expect(moveItemUp(view)).toBe(true);
    expect(text(view)).toBe("- a\n- b\n\nafter");
  });

  it("takes its nested items with it", () => {
    const doc = "- a\n    - a1\n    - a2\n- b";
    const view = makeView(doc, doc.indexOf("b"));
    step(view, moveItemUp);
    expect(text(view)).toBe("- b\n- a\n    - a1\n    - a2");
  });

  it("moves within a nested list, not out of it", () => {
    const doc = "- a\n    - x\n    - y\n- b";
    const view = makeView(doc, doc.indexOf("y"));
    step(view, moveItemUp);
    expect(text(view)).toBe("- a\n    - y\n    - x\n- b");
  });

  it("leaves a numbered list's numbers where they were", () => {
    const doc = "5. a\n6. b\n7. c";
    const view = makeView(doc, doc.indexOf("b"));
    step(view, moveItemUp);
    expect(text(view)).toBe("5. b\n6. a\n7. c");
  });

  it("keeps blank lines between items", () => {
    const doc = "- a\n\n- b\n\n- c";
    const view = makeView(doc, doc.indexOf("c"));
    step(view, moveItemUp);
    expect(text(view)).toBe("- a\n\n- c\n\n- b");
  });

  it("moves tasks, box and all", () => {
    const doc = "- [ ] a\n- [x] b";
    const view = makeView(doc, doc.indexOf("b"));
    step(view, moveItemUp);
    expect(text(view)).toBe("- [x] b\n- [ ] a");
  });

  it("moves the line when it's not in a list", () => {
    const doc = "one\ntwo";
    const view = makeView(doc, doc.indexOf("two"));
    step(view, moveItemUp);
    expect(text(view)).toBe("two\none");
  });

  it("moves the item with Alt-↑ and Alt-↓", () => {
    // nested items, so moving the item and moving the line differ
    const doc = "- a\n    - a1\n- b";
    const view = makeView(doc, doc.indexOf("b"));
    const press = (key: string) => {
      const event = new KeyboardEvent("keydown", {
        key,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      view.contentDOM.dispatchEvent(event);
      ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
      return event;
    };
    expect(press("ArrowUp").defaultPrevented).toBe(true);
    expect(text(view)).toBe("- b\n- a\n    - a1");
    press("ArrowDown");
    expect(text(view)).toBe("- a\n    - a1\n- b");
  });
});
