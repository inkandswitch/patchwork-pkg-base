import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownExtensions } from "./markdown";

afterEach(() => {
  document.body.innerHTML = "";
});

/** an editor with the caret at the very end of `doc` unless `at` says where */
function makeView(doc: string, at = doc.length) {
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

const lines = (view: EditorView) =>
  Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-line"));
const hang = (line: HTMLElement) =>
  line.querySelector<HTMLElement>(".cm-md-hang");

describe("margin", () => {
  it("labels a heading H1/H2 in the margin and hides its #s", () => {
    const view = makeView("# Title\n\n## Sub\n\nbody");
    const [h1, , h2] = lines(view);
    expect(hang(h1)?.textContent).toBe("H1");
    expect(h1.textContent).toBe("H1Title");
    expect(hang(h2)?.textContent).toBe("H2");
    expect(h2.textContent).toBe("H2Sub");
  });

  it("keeps the label even while the caret is on the heading", () => {
    const view = makeView("## Sub\n\nbody", 4);
    const [h2] = lines(view);
    expect(hang(h2)?.textContent).toBe("H2");
    expect(h2.textContent).toBe("H2Sub");
  });

  it("hangs bullets as a dot, and numbers as themselves", () => {
    const view = makeView("- one\n- two\n\n1. first\n2. second\n\nend");
    const [a, b, , c, d] = lines(view);
    expect(hang(a)?.querySelector(".cm-bullet")).not.toBeNull();
    expect(a.textContent).toBe("one");
    expect(b.textContent).toBe("two");
    expect(hang(c)?.textContent).toBe("1.");
    expect(hang(d)?.textContent).toBe("2.");
    expect(d.textContent).toBe("2.second");
  });

  it("numbers a list the way it renders, not the way it's typed", () => {
    const view = makeView("1. a\n2. b\n10. c\n\n5) d\n1) e\n\nend");
    const nums = lines(view).map((l) => hang(l)?.textContent);
    expect(nums).toEqual(["1.", "2.", "3.", undefined, "5)", "6)", undefined, undefined]);
  });

  it("counts nested lists on their own", () => {
    const view = makeView("1. a\n    1. x\n    1. y\n2. b\n\nend");
    const nums = lines(view).map((l) => hang(l)?.textContent);
    expect(nums.slice(0, 4)).toEqual(["1.", "1.", "2.", "2."]);
  });

  it("shows the typed number on the line the caret's on", () => {
    const doc = "1. a\n10. b\n\nend";
    const view = makeView(doc, doc.indexOf("b"));
    const [, b] = lines(view);
    expect(hang(b)?.textContent).toBe("10. ");
  });

  it("puts a task's checkbox where the bullet would be", () => {
    const view = makeView("- [ ] todo\n\nend");
    const [task] = lines(view);
    expect(hang(task)?.querySelector("input.cm-task")).not.toBeNull();
    expect(task.querySelector(".cm-bullet")).toBeNull();
    // the space after the box hangs with it; the text starts on the column.
    expect(hang(task)?.textContent).toBe(" ");
    expect(task.textContent).toBe(" todo");
  });

  it("keeps the number on an ordered task", () => {
    const view = makeView("1. [ ] todo\n\nend");
    const [task] = lines(view);
    expect(hang(task)?.textContent).toBe("1.");
    expect(task.querySelector("input.cm-task")).not.toBeNull();
  });

  it("draws a quote as a bar, hiding the >s", () => {
    const view = makeView("before\n\n> the true\n> the world\n\nafter");
    const [, , q1, q2, , after] = lines(view);
    expect(q1.classList).toContain("cm-md-quote");
    expect(q1.classList).toContain("cm-md-quote-first");
    expect(q2.classList).toContain("cm-md-quote-last");
    expect(q1.textContent).toBe("the true");
    expect(q2.textContent).toBe("the world");
    expect(after.classList).not.toContain("cm-md-quote");
  });

  it("shows the > hung on the line the caret's on", () => {
    const doc = "> the true\n> the world\n\nafter";
    const view = makeView(doc, doc.indexOf("world"));
    const [q1, q2] = lines(view);
    expect(q1.textContent).toBe("the true");
    expect(hang(q2)?.textContent).toBe("> ");
    expect(q2.textContent).toBe("> the world");
  });

  it("gives a nested quote one bar and hides all its >s", () => {
    const view = makeView("> > deep\n\nafter");
    const [q] = lines(view);
    expect(q.className.match(/cm-md-quote-first/g)).toHaveLength(1);
    expect(q.textContent).toBe("deep");
  });
});
