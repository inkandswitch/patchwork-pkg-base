import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownExtensions } from "./markdown";
import { setHeading } from "./headings";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeView(doc: string, at: number) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdownExtensions()],
    }),
  });
}

const press = (view: EditorView, key: string, mods: KeyboardEventInit = {}) =>
  runScopeHandlers(
    view,
    new KeyboardEvent("keydown", { key, ...mods }),
    "editor"
  );
const head = (view: EditorView) => view.state.selection.main.head;
const text = (view: EditorView) => view.state.doc.toString();

describe("headings", () => {
  it("never lets the caret into the #s", () => {
    const view = makeView("# Title", 7);
    view.dispatch({ selection: { anchor: 0 } });
    expect(head(view)).toBe(2);
    view.dispatch({ selection: { anchor: 1 } });
    expect(head(view)).toBe(2);
  });

  it("moving left out of a heading goes to the line above", () => {
    const view = makeView("above\n# Title", 8);
    view.dispatch({ selection: { anchor: 7 } }); // one left of the text
    expect(head(view)).toBe(5); // end of "above"
  });

  it("backspace at the start of a heading makes it body text", () => {
    const view = makeView("# Title", 2);
    expect(press(view, "Backspace")).toBe(true);
    expect(text(view)).toBe("Title");
    expect(head(view)).toBe(0);
  });

  it("backspace inside the text just deletes", () => {
    const view = makeView("# Title", 4);
    press(view, "Backspace");
    expect(text(view)).toBe("# Ttle");
  });

  it("enter at the start of a heading pushes it down", () => {
    const view = makeView("# Title", 2);
    press(view, "Enter");
    expect(text(view)).toBe("\n# Title");
    expect(head(view)).toBe(3);
  });

  it("delete before a heading pulls in its text, not its #s", () => {
    const view = makeView("para\n## Sub", 4);
    press(view, "Delete");
    expect(text(view)).toBe("paraSub");
  });

  it("sets, changes and toggles off the heading level", () => {
    const view = makeView("words", 2);
    setHeading(2)(view);
    expect(text(view)).toBe("## words");
    setHeading(3)(view);
    expect(text(view)).toBe("### words");
    setHeading(3)(view);
    expect(text(view)).toBe("words");
    setHeading(1)(view);
    setHeading(0)(view);
    expect(text(view)).toBe("words");
  });

  it("leaves code blocks alone", () => {
    const doc = "```\n# not a heading\n```";
    const view = makeView(doc, doc.indexOf("#"));
    expect(head(view)).toBe(doc.indexOf("#"));
    press(view, "Backspace");
    expect(text(view)).toBe("```# not a heading\n```");
  });
});
