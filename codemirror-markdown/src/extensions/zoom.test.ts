import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownExtensions } from "./markdown";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeView() {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: "# hi", extensions: markdownExtensions() }),
  });
  return view;
}

// CodeMirror's `Mod` is Cmd on Apple platforms and Ctrl elsewhere.
const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);

function press(view: EditorView, key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey,
    metaKey: mac,
    ctrlKey: !mac,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

const size = (view: EditorView) => view.dom.style.fontSize;
const factor = (view: EditorView) =>
  view.dom.style.getPropertyValue("--markdown-zoom");

describe("text zoom", () => {
  it("grows the text with Mod-= and Mod-+", () => {
    const view = makeView();
    expect(press(view, "=").defaultPrevented).toBe(true);
    expect(size(view)).toBe("17px");
    press(view, "+", true);
    expect(size(view)).toBe("18px");
    expect(factor(view)).toBe(String(18 / 16));
  });

  it("shrinks the text with Mod--, but not below a floor", () => {
    const view = makeView();
    press(view, "-");
    expect(size(view)).toBe("15px");
    for (let i = 0; i < 30; i++) press(view, "-");
    expect(size(view)).toBe("6px");
  });

  it("resets with Mod-0", () => {
    const view = makeView();
    press(view, "=");
    press(view, "0");
    expect(size(view)).toBe("");
    expect(factor(view)).toBe("");
  });
});
