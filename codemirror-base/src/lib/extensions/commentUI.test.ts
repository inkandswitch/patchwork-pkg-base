import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { commentUI, trackPointer } from "./commentUI";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeView(
  options: Partial<Parameters<typeof commentUI>[0]> = {},
  extra: any[] = []
) {
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
          ...options,
        }),
        ...extra,
      ],
    }),
  });
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

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

  it("is the same button as the selection is extended", async () => {
    const view = makeView();
    view.dispatch({ selection: { anchor: 5, head: 10 } });
    await frame();
    const first = button(view);
    expect(first).not.toBeNull();
    view.dispatch({ selection: { anchor: 5, head: 12 } });
    await frame();
    expect(button(view)).toBe(first);
  });

  it("comments on the selection as it is when pressed", async () => {
    const createThreadForRange = vi.fn(() => null);
    const view = makeView({ createThreadForRange });
    view.dispatch({ selection: { anchor: 5, head: 10 } });
    await frame();
    view.dispatch({ selection: { anchor: 5, head: 12 } });
    await frame();
    mouse(button(view)!, "click");
    expect(createThreadForRange).toHaveBeenCalledWith(5, 12);
  });
});

describe("the thread popover", () => {
  it("stays open, and is not closed, as the document changes under it", async () => {
    const onClose = vi.fn();
    const view = makeView({
      createThreadForRange: () => "automerge:thread" as any,
      onClose,
    });
    view.dispatch({ selection: { anchor: 5, head: 10 } });
    await frame();
    mouse(button(view)!, "click");
    await frame();
    const popover = view.dom.querySelector(".cm-comment-popover");
    expect(popover).not.toBeNull();

    view.dispatch({ changes: { from: 0, insert: "more " } });
    await frame();
    expect(view.dom.querySelector(".cm-comment-popover")).toBe(popover);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("clicking commented text", () => {
  const thread = "automerge:thread" as any;
  // "words" (5..10) is commented
  const threadAtPos = (pos: number) =>
    pos >= 5 && pos <= 10 ? { threadUrl: thread, from: 5 } : null;

  // a click at `pos`: our mousedown, then the caret landing there
  async function clickAt(view: EditorView, pos: number) {
    view.posAtCoords = (() => pos) as any;
    mouse(view.contentDOM, "mousedown");
    view.dispatch({ selection: { anchor: pos } });
    mouse(window, "mouseup");
    await frame();
  }
  const peek = (view: EditorView) => view.dom.querySelector(".cm-comment-peek");
  // after ours, stop the mousedown before CodeMirror's own mouse selection,
  // which needs layout happy-dom lacks (the test moves the caret itself)
  const noMouseSelection = EditorView.domEventHandlers({ mousedown: () => true });

  it("offers to show the comment rather than opening the comments panel", async () => {
    const openThreadsElsewhere = vi.fn(() => true);
    const view = makeView({ threadAtPos, openThreadsElsewhere }, [noMouseSelection]);
    await clickAt(view, 7);
    expect(openThreadsElsewhere).not.toHaveBeenCalled();
    expect(peek(view)?.textContent).toBe("View comment");

    mouse(peek(view)!, "click");
    expect(openThreadsElsewhere).toHaveBeenCalledOnce();
    await frame();
    expect(peek(view)).toBeNull();
  });

  it("opens the thread inline when nothing can show it", async () => {
    const view = makeView({ threadAtPos, openThreadsElsewhere: () => false }, [
      noMouseSelection,
    ]);
    await clickAt(view, 7);
    mouse(peek(view)!, "click");
    await frame();
    expect(view.dom.querySelector(".cm-comment-popover")).not.toBeNull();
  });

  it("puts the offer away once the caret leaves the comment", async () => {
    const view = makeView({ threadAtPos, openThreadsElsewhere: () => true }, [
      noMouseSelection,
    ]);
    await clickAt(view, 7);
    const chip = peek(view);
    view.dispatch({ selection: { anchor: 8 } });
    await frame();
    expect(peek(view)).toBe(chip);
    view.dispatch({ selection: { anchor: 15 } });
    await frame();
    expect(peek(view)).toBeNull();
  });

  it("does nothing extra while a comments panel is already showing", async () => {
    const view = makeView(
      {
        threadAtPos,
        threadsShownElsewhere: () => true,
        openThreadsElsewhere: () => true,
      },
      [noMouseSelection]
    );
    await clickAt(view, 7);
    expect(peek(view)).toBeNull();
  });
});
