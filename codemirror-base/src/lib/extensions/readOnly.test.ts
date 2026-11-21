import { afterEach, describe, expect, it } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { readOnlyExtensions } from "../../vendor/automerge-codemirror/index.js";
import { reconcileAnnotationType } from "../../vendor/automerge-codemirror/plugin.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeView(doc = "hello") {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [readOnlyExtensions] }),
  });
}

describe("readOnlyExtensions", () => {
  it("leaves the content focusable, so keys still reach the editor", () => {
    const view = makeView();
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("true");
    expect(view.contentDOM.getAttribute("aria-readonly")).toBe("true");
    expect(view.contentDOM.getAttribute("inputmode")).toBe("none");
    expect(view.state.readOnly).toBe(true);
  });

  it("drops edits from commands that don't check readOnly", () => {
    const view = makeView();
    view.dispatch({
      changes: { from: 0, insert: "oops " },
      userEvent: "input.type",
    });
    view.dispatch({ changes: { from: 0, insert: "no event " } });
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("lets syncs from outside through", () => {
    const view = makeView();
    view.dispatch({
      changes: { from: 5, insert: " world" },
      annotations: reconcileAnnotationType.of({}),
    });
    view.dispatch({
      changes: { from: 0, insert: ">" },
      annotations: Transaction.remote.of(true),
    });
    expect(view.state.doc.toString()).toBe(">hello world");
  });

  it("still moves the selection", () => {
    const view = makeView();
    view.dispatch({ selection: { anchor: 2, head: 4 } });
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(4);
  });
});
