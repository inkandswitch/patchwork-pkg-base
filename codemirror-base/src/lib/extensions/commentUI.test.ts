import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { commentUI, trackPointer } from "./commentUI";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeView() {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: "some words to comment on",
      extensions: [
        commentUI({
          createThreadForRange: () => null,
          threadAtPos: () => null,
          watchThreadForClose: () => () => {},
          onClose: () => {},
        }),
      ],
    }),
  });
}

const button = (view: EditorView) =>
  view.dom.querySelector(".cm-comment-button");
const mouse = (target: EventTarget, type: string) =>
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })
  );

describe("the comment button", () => {
  it("waits for the mouse to come up before showing", async () => {
    const view = makeView();
    // what the editor's mousedown handler does (a real mousedown here would
    // run CodeMirror's mouse selection, which needs layout happy-dom lacks)
    trackPointer(view);
    view.dispatch({ selection: { anchor: 5, head: 10 } });
    expect(button(view)).toBeNull();
    mouse(window, "mouseup");
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(button(view)).not.toBeNull();
  });

  it("shows straight away for a keyboard selection", async () => {
    const view = makeView();
    view.dispatch({ selection: { anchor: 5, head: 10 } });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(button(view)).not.toBeNull();
  });
});
