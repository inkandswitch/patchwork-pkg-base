import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownExtensions } from "./markdown";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeView(doc: string, editable = true) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [markdownExtensions(), EditorView.editable.of(editable)],
    }),
  });
}

const boxes = (view: EditorView) =>
  Array.from(
    view.contentDOM.querySelectorAll<HTMLInputElement>("input.cm-task")
  );

const click = (box: HTMLInputElement) =>
  box.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true })
  );

describe("gfm task lists", () => {
  it("renders a checkbox for each task marker", () => {
    const view = makeView("- [ ] todo\n- [x] done\n* [X] also done\n- plain");
    expect(boxes(view).map((b) => b.checked)).toEqual([false, true, true]);
  });

  it("leaves things that aren't tasks alone", () => {
    const view = makeView("[ ] not in a list\n\n```\n- [ ] in code\n```");
    expect(boxes(view)).toHaveLength(0);
  });

  it("renders tasks in ordered and nested lists", () => {
    const view = makeView("1. [ ] one\n    - [x] nested");
    expect(boxes(view).map((b) => b.checked)).toEqual([false, true]);
  });

  it("ticks an unchecked task when clicked", () => {
    const view = makeView("- [ ] todo");
    click(boxes(view)[0]);
    expect(view.state.doc.toString()).toBe("- [x] todo");
    expect(boxes(view)[0].checked).toBe(true);
  });

  it("unticks a checked task when clicked", () => {
    const view = makeView("- [ ] a\n- [X] b");
    click(boxes(view)[1]);
    expect(view.state.doc.toString()).toBe("- [ ] a\n- [ ] b");
  });

  it("doesn't toggle in a read-only editor", () => {
    const view = makeView("- [ ] todo", false);
    expect(boxes(view)[0].disabled).toBe(true);
    click(boxes(view)[0]);
    expect(view.state.doc.toString()).toBe("- [ ] todo");
  });

  it("fades the text of done tasks, not open ones", () => {
    const view = makeView("- [ ] todo\n- [x] done\n    - [ ] nested");
    const faded = Array.from(
      view.contentDOM.querySelectorAll(".cm-task-done")
    ).map((el) => el.textContent);
    expect(faded).toEqual([" done"]);
  });
});
