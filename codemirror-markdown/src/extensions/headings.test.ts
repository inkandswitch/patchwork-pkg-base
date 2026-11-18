import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownExtensions } from "./markdown";
import { setHeading } from "./headings";

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
  // finish parsing now (a busy test run can leave the tree partial), and
  // dispatch so the view plugins rebuild against the whole tree.
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
  view.dispatch({});
  return view;
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

  describe("level menu", () => {
    const menu = () => document.querySelector<HTMLElement>(".cm-md-menu");
    const entries = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(".cm-md-menu-item"));
    const key = (key: string) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
      );

    it("opens on left at the start of a heading's text, on its level", () => {
      const view = makeView("above\n## Title", 9);
      expect(press(view, "ArrowLeft")).toBe(true);
      expect(entries().map((b) => b.textContent)).toEqual([
        "Heading 1", "Heading 2", "Heading 3", "Heading 4", "Heading 5", "Heading 6",
      ]);
      expect(document.activeElement).toBe(entries()[1]);
      expect(entries()[1].getAttribute("aria-checked")).toBe("true");
      expect(text(view)).toBe("above\n## Title");
    });

    it("doesn't open from inside the text, or off a heading", () => {
      const view = makeView("# Title\nbody", 4);
      press(view, "ArrowLeft");
      expect(menu()).toBeNull();
      expect(head(view)).toBe(3);
      view.dispatch({ selection: { anchor: 8 } });
      press(view, "ArrowLeft");
      expect(menu()).toBeNull();
    });

    it("moves with up and down, and picks a level", () => {
      const view = makeView("# Title", 2);
      press(view, "ArrowLeft");
      key("ArrowDown");
      key("ArrowDown");
      expect(document.activeElement).toBe(entries()[2]);
      entries()[2].click();
      expect(text(view)).toBe("### Title");
      expect(head(view)).toBe(4);
      expect(menu()).toBeNull();
    });

    it("closes on escape or right, leaving the heading as it was", () => {
      for (const k of ["Escape", "ArrowRight"]) {
        const view = makeView("# Title", 2);
        press(view, "ArrowLeft");
        key(k);
        expect(menu(), k).toBeNull();
        expect(text(view)).toBe("# Title");
        expect(head(view)).toBe(2);
        view.destroy();
      }
    });

    it("a second left goes on to the line above", () => {
      const view = makeView("above\n# Title", 8);
      press(view, "ArrowLeft");
      key("ArrowLeft");
      expect(menu()).toBeNull();
      expect(head(view)).toBe(5);
    });

    it("opens on a click on the label", () => {
      const view = makeView("## Title", 3);
      const label = view.contentDOM.querySelector(".cm-md-heading-label")!;
      label.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      expect(entries()).toHaveLength(6);
      entries()[0].click();
      expect(text(view)).toBe("# Title");
    });

    it("changes a heading in a quote, keeping the quote", () => {
      const view = makeView("> ## Title", 5);
      press(view, "ArrowLeft");
      entries()[3].click();
      expect(text(view)).toBe("> #### Title");
    });
  });
});
