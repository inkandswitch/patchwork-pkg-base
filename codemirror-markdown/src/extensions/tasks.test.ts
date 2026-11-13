import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownExtensions } from "./markdown";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeView(doc: string, editable = true) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [markdownExtensions(), EditorView.editable.of(editable)],
    }),
  });
  // a busy test run can leave the tree partial; finish it, and dispatch so
  // the view plugins rebuild against the whole tree.
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
  view.dispatch({});
  return view;
}

const boxes = (view: EditorView) =>
  Array.from(
    view.contentDOM.querySelectorAll<HTMLElement>(".cm-task")
  );

const checked = (box: HTMLElement) => box.getAttribute("aria-checked") === "true";

const click = (box: HTMLElement) =>
  box.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true })
  );

describe("gfm task lists", () => {
  it("renders a checkbox for each task marker", () => {
    const view = makeView("- [ ] todo\n- [x] done\n* [X] also done\n- plain");
    expect(boxes(view).map(checked)).toEqual([false, true, true]);
  });

  it("leaves things that aren't tasks alone", () => {
    const view = makeView("[ ] not in a list\n\n```\n- [ ] in code\n```");
    expect(boxes(view)).toHaveLength(0);
  });

  it("renders tasks in ordered and nested lists", () => {
    const view = makeView("1. [ ] one\n    - [x] nested");
    expect(boxes(view).map(checked)).toEqual([false, true]);
  });

  it("ticks an unchecked task when clicked", () => {
    const view = makeView("- [ ] todo");
    click(boxes(view)[0]);
    expect(view.state.doc.toString()).toBe("- [x] todo");
    expect(checked(boxes(view)[0])).toBe(true);
  });

  it("doesn't tick on a right-click", () => {
    const view = makeView("- [ ] todo");
    boxes(view)[0].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 })
    );
    expect(view.state.doc.toString()).toBe("- [ ] todo");
  });

  it("unticks a checked task when clicked", () => {
    const view = makeView("- [ ] a\n- [X] b");
    click(boxes(view)[1]);
    expect(view.state.doc.toString()).toBe("- [ ] a\n- [ ] b");
  });

  it("doesn't toggle in a read-only editor", () => {
    const view = makeView("- [ ] todo", false);
    expect(boxes(view)[0].getAttribute("aria-disabled")).toBe("true");
    click(boxes(view)[0]);
    expect(view.state.doc.toString()).toBe("- [ ] todo");
  });

  it("fades the text of done tasks, not open ones", () => {
    const view = makeView("- [ ] todo\n- [x] done\n    - [ ] nested");
    const faded = Array.from(
      view.contentDOM.querySelectorAll(".cm-task-done")
    ).map((el) => el.textContent);
    // the margin (margin.ts) hides the space after the box.
    expect(faded.join("")).toBe("done");
  });

  describe("Mod-k", () => {
    // CodeMirror's `Mod` is Cmd on Apple platforms and Ctrl elsewhere.
    const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
    const press = (view: EditorView) => {
      const event = new KeyboardEvent("keydown", {
        key: "k",
        metaKey: mac,
        ctrlKey: !mac,
        bubbles: true,
        cancelable: true,
      });
      view.contentDOM.dispatchEvent(event);
      return event;
    };
    const at = (view: EditorView, anchor: number, head = anchor) =>
      view.dispatch({ selection: EditorSelection.single(anchor, head) });

    it("ticks the task the caret is in, and unticks it again", () => {
      const view = makeView("- [ ] a\n- [ ] b");
      at(view, view.state.doc.toString().indexOf("b"));
      expect(press(view).defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe("- [ ] a\n- [x] b");
      press(view);
      expect(view.state.doc.toString()).toBe("- [ ] a\n- [ ] b");
    });

    it("works with the caret anywhere on the line, even before the box", () => {
      const view = makeView("- [ ] a");
      at(view, 0);
      press(view);
      expect(view.state.doc.toString()).toBe("- [x] a");
    });

    it("ticks every task in the selection, or unticks them if all are done", () => {
      const doc = "- [x] a\n- [ ] b\n- [ ] c\n- [ ] d";
      const view = makeView(doc);
      at(view, doc.indexOf("a"), doc.indexOf("c"));
      press(view);
      expect(view.state.doc.toString()).toBe("- [x] a\n- [x] b\n- [x] c\n- [ ] d");
      press(view);
      expect(view.state.doc.toString()).toBe("- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d");
    });

    it("ticks a nested task on its own, not its parent", () => {
      const doc = "- [ ] a\n    - [ ] a1";
      const view = makeView(doc);
      at(view, doc.indexOf("a1"));
      press(view);
      expect(view.state.doc.toString()).toBe("- [ ] a\n    - [x] a1");
    });

    it("lets the key through off a task", () => {
      const view = makeView("- plain\n\ntext");
      at(view, 3);
      expect(press(view).defaultPrevented).toBe(false);
      expect(view.state.doc.toString()).toBe("- plain\n\ntext");
    });

    it("does nothing in a read-only editor", () => {
      const view = makeView("- [ ] a", false);
      at(view, 6);
      press(view);
      expect(view.state.doc.toString()).toBe("- [ ] a");
    });
  });
});
