import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { markdownExtensions } from "./markdown";

afterEach(() => {
  document.body.innerHTML = "";
});

/** an editor with the caret at the very end of `doc` unless `at` says where */
function makeView(doc: string, at = doc.length) {
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

  it("marks heading lines with their level, for widgets in them", () => {
    const view = makeView("## See [the tale](https://a.com)\n\nbody");
    const [h2] = lines(view);
    expect(h2.classList).toContain("cm-md-h2");
    expect(h2.querySelector("a.cm-link")).toBeNull(); // links are another plugin
  });

  it("marks setext heading text lines with their level, not the underline", () => {
    const view = makeView("Title\nmore\n===\n\nSub\n---\n\nbody");
    const [t1, t2, u1, , s, u2] = lines(view);
    expect(t1.classList).toContain("cm-md-h1");
    expect(t2.classList).toContain("cm-md-h1");
    expect(u1.className).not.toMatch(/cm-md-h\d/);
    expect(s.classList).toContain("cm-md-h2");
    expect(u2.className).not.toMatch(/cm-md-h\d/);
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

  it("tints the markers a selection covers, as selected text is", () => {
    const doc = "- one\n- two\n\n1. first\n\n- [ ] task\n\nend";
    const view = makeView(doc);
    const selected = () =>
      lines(view).map((l) => !!l.querySelector(".cm-md-list-marker-selected"));
    expect(selected()).toEqual([false, false, false, false, false, false, false, false]);

    // select all: every marker
    view.dispatch({ selection: EditorSelection.range(0, doc.length) });
    expect(selected()).toEqual([true, true, false, true, false, true, false, false]);

    // from inside "one" to inside "two": the second marker is covered, the
    // first (before the selection) isn't
    view.dispatch({ selection: EditorSelection.range(3, 9) });
    expect(selected()).toEqual([false, true, false, false, false, false, false, false]);

    // a caret covers nothing
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(selected().some(Boolean)).toBe(false);
  });

  it("picks out the heading labels a selection covers", () => {
    const doc = "# One\n\n## Two\n\nend";
    const view = makeView(doc, doc.length);
    const selected = () =>
      lines(view)
        .filter((l) => l.querySelector(".cm-md-heading-label"))
        .map((l) => !!l.querySelector(".cm-md-heading-label-selected"));
    expect(selected()).toEqual([false, false]);
    view.dispatch({ selection: EditorSelection.range(0, doc.length) });
    expect(selected()).toEqual([true, true]);
    // from inside "One" on: only the second's `## `
    view.dispatch({ selection: EditorSelection.range(3, doc.length) });
    expect(selected()).toEqual([false, true]);
  });

  it("tints the quote indents a selection covers, one band per bar", () => {
    const doc = "> one\n> > two\n\nend";
    const view = makeView(doc);
    const bands = () =>
      lines(view).map((l) => l.querySelectorAll(".cm-md-quote-selected").length);
    expect(bands()).toEqual([0, 0, 0, 0]);

    // select all: each quote line, a band for each bar it has
    view.dispatch({ selection: EditorSelection.range(0, doc.length) });
    expect(bands()).toEqual([1, 2, 0, 0]);

    // from inside "one" into "two": only the second line's `> > ` is covered
    view.dispatch({ selection: EditorSelection.range(3, 11) });
    expect(bands()).toEqual([0, 2, 0, 0]);

    // a caret covers nothing
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(bands()).toEqual([0, 0, 0, 0]);
  });

  it("leaves a bare bullet as typed until its space comes", () => {
    for (const ch of ["-", "*", "+"]) {
      const view = makeView(ch);
      const [line] = lines(view);
      expect(line.querySelector(".cm-bullet"), ch).toBeNull();
      expect(line.textContent, ch).toBe(ch);
      expect(line.classList.contains("cm-md-list-line"), ch).toBe(false);
    }
    const spaced = makeView("- ");
    expect(lines(spaced)[0].querySelector(".cm-bullet")).not.toBeNull();
  });

  it("leaves a bare number as typed until its space comes", () => {
    for (const mark of ["1.", "10.", "1)"]) {
      const view = makeView(mark);
      const [line] = lines(view);
      expect(hang(line), mark).toBeNull();
      expect(line.textContent, mark).toBe(mark);
      expect(line.classList.contains("cm-md-list-line"), mark).toBe(false);
    }
    expect(hang(lines(makeView("1. "))[0])?.textContent).toBe("1.");
  });

  it("leaves a bare # as typed until its space comes", () => {
    for (const mark of ["#", "##", "######"]) {
      const view = makeView(mark);
      const [line] = lines(view);
      expect(hang(line), mark).toBeNull();
      expect(line.textContent, mark).toBe(mark);
      expect(line.className, mark).not.toMatch(/cm-md-h\d/);
      expect(line.classList, mark).toContain("cm-md-bare-heading");
    }
    const spaced = lines(makeView("# "))[0];
    expect(hang(spaced)?.textContent).toBe("H1");
    expect(spaced.classList).not.toContain("cm-md-bare-heading");
  });

  it("leaves a bare # or number in an item as typed, at the item's text", () => {
    for (const [doc, shown] of [["- #", "#"], ["- 1.", "1."], ["> ##", "##"]]) {
      const [line] = lines(makeView(doc));
      expect(line.textContent, doc).toBe(shown);
      expect(line.querySelector(".cm-md-heading-label"), doc).toBeNull();
    }
  });

  it("leaves a bare bullet nested in an item as typed, at the item's text", () => {
    const view = makeView("* *");
    const [line] = lines(view);
    expect(line.querySelectorAll(".cm-bullet").length).toBe(1);
    expect(line.textContent).toBe("*");
  });

  it("numbers a list the way it renders, not the way it's typed", () => {
    const view = makeView("1. a\n2. b\n10. c\n\n5) d\n1) e\n\nend");
    const nums = lines(view).map((l) => hang(l)?.textContent);
    expect(nums).toEqual(["1.", "2.", "3.", undefined, "5)", "6)", undefined, undefined]);
  });

  it("counts a third level in letters", () => {
    const view = makeView("1. a\n    1. b\n        1. c\n        2. d\n\nend");
    const nums = lines(view).map((l) => hang(l)?.textContent);
    expect(nums.slice(0, 4)).toEqual(["1.", "i.", "a.", "b."]);
  });

  it("counts nested lists on their own", () => {
    const view = makeView("1. a\n    1. x\n    1. y\n2. b\n\nend");
    const nums = lines(view).map((l) => hang(l)?.textContent);
    // the way GitHub draws them: 1. → i. → a.
    expect(nums.slice(0, 4)).toEqual(["1.", "i.", "ii.", "2."]);
  });

  it("shows the rendered number even on the line the caret's on", () => {
    const doc = "1. a\n10. b\n\nend";
    const view = makeView(doc, doc.indexOf("b"));
    const [, b] = lines(view);
    expect(hang(b)?.textContent).toBe("2.");
  });

  it("puts a task's checkbox where the bullet would be", () => {
    const view = makeView("- [ ] todo\n\nend");
    const [task] = lines(view);
    expect(hang(task)?.querySelector(".cm-task")).not.toBeNull();
    expect(task.querySelector(".cm-bullet")).toBeNull();
    // the space after the box is hidden, so the text (and a caret at its
    // start) begins on the column.
    expect(hang(task)?.textContent).toBe("");
    expect(task.textContent).toBe("todo");
  });

  it("keeps the number on an ordered task", () => {
    const view = makeView("1. [ ] todo\n\nend");
    const [task] = lines(view);
    expect(hang(task)?.textContent).toBe("1.");
    expect(task.querySelector(".cm-task")).not.toBeNull();
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

  it("never shows the >, even on the line the caret's on", () => {
    const doc = "> the true\n> the world\n\nafter";
    const view = makeView(doc, doc.indexOf("world"));
    const [, q2] = lines(view);
    expect(q2.textContent).toBe("the world");
  });

  const bars = (line: HTMLElement) =>
    Array.from(line.querySelectorAll<HTMLElement>(".cm-md-quote-bar"));
  const inset = (line: HTMLElement) => line.style.getPropertyValue("--md-inset");

  it("gives a nested quote a bar of its own, and hides all its >s", () => {
    const view = makeView("> out\n> > deep\n> > > deeper\n\nafter");
    const [out, deep, deeper, , after] = lines(view);
    expect([out, deep, deeper].map((l) => bars(l).length)).toEqual([1, 2, 3]);
    expect(deep.textContent).toBe("deep");
    expect(deeper.textContent).toBe("deeper");
    // each bar one indent further in than the one before
    expect(new Set(bars(deeper).map((b) => b.getAttribute("style"))).size).toBe(3);
    expect(inset(deeper)).toContain("3 * var(--markdown-quote-indent)");
    // the inner quote's bar starts on its own first line
    expect(bars(deep)[1].classList).toContain("cm-md-quote-bar-first");
    expect(bars(deep)[0].classList).not.toContain("cm-md-quote-bar-first");
    expect(bars(after)).toHaveLength(0);
  });

  it("puts a list in a quote inside the bar, not on it", () => {
    const view = makeView("> - a\n> - b\n\nafter");
    const [a, b] = lines(view);
    for (const l of [a, b]) {
      expect(bars(l)).toHaveLength(1);
      expect(inset(l)).toBe(
        "calc(1 * var(--markdown-quote-indent) + 1 * var(--markdown-list-indent))"
      );
      expect(l.querySelector(".cm-bullet")).not.toBeNull();
    }
    expect(a.textContent).toBe("a");
  });

  it("moves an item's marker out past a quote that starts on its line", () => {
    const view = makeView("- > quoted\n  > more\n\nafter");
    const [first, more] = lines(view);
    expect(first.textContent).toBe("quoted");
    expect(more.textContent).toBe("more");
    expect(bars(first)).toHaveLength(1);
    const marker = first.querySelector<HTMLElement>(".cm-md-list-marker")!;
    expect(marker.getAttribute("style")).toContain("var(--markdown-quote-indent)");
  });

  it("indents code in a list item, hiding the item's indentation but not the code's", () => {
    const doc = "- item\n\n  ```js\n  if (a)\n    b()\n  ```\n\nend";
    const view = makeView(doc);
    const [, , fence, ifLine, body, close] = lines(view);
    for (const l of [fence, ifLine, body, close]) {
      expect(l.classList).toContain("cm-md-code");
      expect(inset(l)).toContain("1 * var(--markdown-list-indent)");
    }
    expect(fence.textContent).toBe("```js");
    expect(ifLine.textContent).toBe("if (a)");
    expect(body.textContent).toBe("  b()");
  });

  it("keeps a quote's > inside its code as code", () => {
    const view = makeView("> ```\n> >x\n> ```\n\nend");
    const [, code] = lines(view);
    expect(code.textContent).toBe(">x");
    expect(bars(code)).toHaveLength(1);
  });

  it("shows a heading's label only on the caret's line", () => {
    const doc = "# One\n\n## Two\n\nend";
    const view = makeView(doc, doc.indexOf("Two"));
    const [one, , two] = lines(view);
    expect(hang(one)?.classList).toContain("cm-md-heading-label-idle");
    expect(hang(two)?.classList).not.toContain("cm-md-heading-label-idle");
  });

  it("puts every line of a code block in the code font", () => {
    const view = makeView("```js\nhello\nfunction f() {}\n```\n\nend");
    const code = lines(view).slice(0, 4);
    expect(code.every((l) => l.classList.contains("cm-md-code"))).toBe(true);
    expect(lines(view)[5].classList).not.toContain("cm-md-code");
  });

  it("indents list lines by depth, hiding their markdown indentation", () => {
    const view = makeView("- a\n    - b\n      more b\n- c\n\nend");
    const [a, b, more, c, , end] = lines(view);
    const depth = (l: HTMLElement) => l.style.getPropertyValue("--md-list-depth");
    expect([a, b, more, c].map(depth)).toEqual(["1", "2", "2", "1"]);
    expect(b.textContent).toBe("b");
    expect(more.textContent).toBe("more b");
    expect(end.classList).not.toContain("cm-md-list-line");
  });

  describe("callouts", () => {
    const doc = "> [!WARNING]\n> Mind the gap\n\n> just a quote\n\nend";

    it("draws the marker as an icon and title, and tints the box", () => {
      const view = makeView(doc);
      const [title, body, , quote] = lines(view);
      for (const l of [title, body]) {
        expect(l.classList).toContain("cm-md-callout");
        expect(l.classList).toContain("cm-md-callout-warning");
      }
      const t = title.querySelector(".cm-md-callout-title")!;
      expect(t.querySelector("svg")).not.toBeNull();
      expect(t.textContent).toBe("Warning");
      expect(title.textContent).toBe("Warning");
      expect(body.textContent).toBe("Mind the gap");
      expect(quote.classList).not.toContain("cm-md-callout");
    });

    it("shows the marker as text while the caret is on it", () => {
      const view = makeView(doc, 4);
      const [title] = lines(view);
      expect(title.querySelector(".cm-md-callout-title")).toBeNull();
      expect(title.textContent).toBe("[!WARNING]");
    });

    it("takes text after the marker as the title, and ignores unknown types", () => {
      const view = makeView("> [!tip] Shortcuts\n> body\n\n> [!NOPE]\n\nend");
      const [title, , , nope] = lines(view);
      expect(title.classList).toContain("cm-md-callout-tip");
      expect(title.textContent).toBe("Shortcuts");
      expect(nope.classList).not.toContain("cm-md-callout");
    });

    it("parses callouts nested inside blockquotes", () => {
      const view = makeView("> > [!NOTE]\n> > inside\n\nend");
      const [title, body] = lines(view);
      expect(title.classList).toContain("cm-md-callout-note");
      expect(title.textContent).toBe("Note");
      expect(body.textContent).toBe("inside");
    });
  });

  it("draws --- and *** as a rule, and shows them on the caret's line", () => {
    const doc = "a\n\n---\n\nb\n\n***\n\nend";
    const view = makeView(doc, doc.indexOf("***") + 1);
    const ls = lines(view);
    expect(ls[2].querySelector(".cm-md-hr")).not.toBeNull();
    expect(ls[2].textContent).toBe("");
    expect(ls[6].querySelector(".cm-md-hr")).toBeNull();
    expect(ls[6].textContent).toBe("***");
  });

  it("changes the bullet's shape with depth: dot, ring, diamond, round again", () => {
    const view = makeView("- a\n    - b\n        - c\n            - d\n- e\n\nend");
    const shapes = lines(view)
      .slice(0, 5)
      .map((l) => l.querySelector(".cm-bullet")!.className.replace("cm-bullet cm-bullet-", ""));
    expect(shapes).toEqual(["disc", "circle", "diamond", "disc", "disc"]);
  });
});
