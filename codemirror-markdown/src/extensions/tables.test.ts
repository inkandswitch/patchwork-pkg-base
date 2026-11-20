import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { markdownExtensions } from "./markdown";
import {
  alignments,
  columnWidths,
  lineUpRow,
  nextCell,
  nextRow,
  previousCell,
  splitRow,
} from "./tables";

afterEach(() => {
  document.body.innerHTML = "";
});

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
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
  view.dispatch({});
  return view;
}

const run = (view: EditorView, command: typeof nextCell) =>
  command({ state: view.state, dispatch: (tr) => view.dispatch(tr) });

/** the doc with a `|` caret marker... no: with `^` at the caret */
const withCaret = (view: EditorView) => {
  const { head } = view.state.selection.main;
  const doc = view.state.doc.toString();
  return doc.slice(0, head) + "^" + doc.slice(head);
};

/** apply lineUpRow's edits to `text` */
function lineUp(text: string, widths: number[], delimiter: ReturnType<typeof alignments> | null = null) {
  let out = text;
  for (const c of lineUpRow(text, widths, delimiter).reverse())
    out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

const cellText = (text: string) =>
  splitRow(text).cells.map((c) => text.slice(c.textFrom, c.textTo));

describe("splitRow", () => {
  it("splits on pipes, with or without the outer ones", () => {
    expect(cellText("| a | b |")).toEqual(["a", "b"]);
    expect(cellText("a | b")).toEqual(["a", "b"]);
    expect(cellText("| a | b")).toEqual(["a", "b"]);
    expect(cellText("  a | b |  ")).toEqual(["a", "b"]);
  });

  it("keeps empty cells", () => {
    expect(cellText("| a |  | c |")).toEqual(["a", "", "c"]);
    expect(cellText("|||")).toEqual(["", ""]);
  });

  it("doesn't split at an escaped pipe", () => {
    expect(cellText("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
    expect(cellText("| a \\|")).toEqual(["a \\|"]);
  });
});

describe("alignments", () => {
  it("reads colons", () => {
    expect(alignments("|---|:--|--:|:-:|")).toEqual([null, "left", "right", "center"]);
  });
});

describe("lining up", () => {
  it("pads every cell to its column", () => {
    const rows = ["| a | bb |", "|-|:-:|", "| cccc | d |"];
    const widths = columnWidths(rows);
    expect(widths).toEqual([4, 3]);
    expect(lineUp(rows[0], widths)).toBe("| a    | bb  |");
    expect(lineUp(rows[1], widths, alignments(rows[1]))).toBe("| ---- | :-: |");
    expect(lineUp(rows[2], widths)).toBe("| cccc | d   |");
  });

  it("adds the outer pipes and the missing cells", () => {
    expect(lineUp("a|b", [3, 3, 3])).toBe("| a   | b   |     |");
    expect(lineUp("  | a", [3, 3])).toBe("| a   |     |");
    expect(lineUp("| a |", [3, 3])).toBe("| a   |     |");
    expect(lineUp("|", [3])).toBe("|     |");
  });

  it("changes nothing on a lined-up row", () => {
    expect(lineUpRow("| a   | bb  |", [3, 3], null)).toEqual([]);
    expect(lineUpRow("| --- | :-: |", [3, 3], [null, "center"])).toEqual([]);
  });

  it("never edits a cell's own text", () => {
    const text = "|x  y|  `a|b`|\\|";
    for (const c of lineUpRow(text, [9, 9, 9], null)) {
      expect(text.slice(c.from, c.to).trim().replace(/\|/g, "")).toBe("");
    }
  });
});

const TABLE = "| a | b |\n|---|--:|\n| 1 | **two** |";

describe("drawing", () => {
  it("draws a table away from the caret", () => {
    const view = makeView(TABLE + "\n\nafter");
    const table = view.contentDOM.querySelector(".cm-md-table table")!;
    expect(table).not.toBeNull();
    expect([...table.querySelectorAll("th")].map((c) => c.textContent)).toEqual(["a", "b"]);
    const cells = [...table.querySelectorAll("td")];
    expect(cells.map((c) => c.textContent)).toEqual(["1", "two"]);
    expect(cells[1].querySelector("strong")?.textContent).toBe("two");
    expect(cells[1].style.textAlign).toBe("right");
  });

  it("shows the source while the caret is in it", () => {
    const view = makeView(TABLE + "\n\nafter", 3);
    expect(view.contentDOM.querySelector(".cm-md-table")).toBeNull();
    expect(view.contentDOM.querySelectorAll(".cm-md-table-source").length).toBe(3);
  });

  it("draws code, links and escapes in cells", () => {
    const view = makeView("| x |\n|---|\n| `c` [t](https://a.com) \\| ~~s~~ |\n\nafter");
    const td = view.contentDOM.querySelector(".cm-md-table td")!;
    expect(td.textContent).toBe("c t | s");
    expect(td.querySelector("code")?.textContent).toBe("c");
    expect(td.querySelector<HTMLElement>("a.cm-link")?.dataset.href).toBe("https://a.com");
    expect(td.querySelector("s")?.textContent).toBe("s");
  });

  it("fills a short row out and drops a long row's extras", () => {
    const view = makeView("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |\n\nafter");
    const rows = [...view.contentDOM.querySelectorAll(".cm-md-table tbody tr")];
    expect(rows.map((r) => r.children.length)).toEqual([2, 2]);
  });

  it("leaves a table in a quote as source", () => {
    const view = makeView("> | a |\n> |---|\n> | 1 |\n\nafter");
    expect(view.contentDOM.querySelector(".cm-md-table")).toBeNull();
  });

  it("puts the caret in the clicked cell", () => {
    const view = makeView(TABLE + "\n\nafter");
    const td = view.contentDOM.querySelectorAll(".cm-md-table td")[1];
    td.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(withCaret(view)).toBe("| a | b |\n|---|--:|\n| 1 | ^**two** |\n\nafter");
    expect(view.contentDOM.querySelector(".cm-md-table")).toBeNull();
  });
});

describe("keys", () => {
  it("Tab lines up and goes to the next cell, skipping the delimiter row", () => {
    const view = makeView(TABLE, 3);
    expect(run(view, nextCell)).toBe(true);
    expect(withCaret(view)).toBe("| a   | b^       |\n| --- | ------: |\n| 1   | **two** |");
    run(view, nextCell);
    expect(withCaret(view)).toBe("| a   | b       |\n| --- | ------: |\n| 1^   | **two** |");
  });

  it("Tab in the last cell adds a row", () => {
    const view = makeView(TABLE);
    run(view, nextCell);
    expect(withCaret(view)).toBe(
      "| a   | b       |\n| --- | ------: |\n| 1   | **two** |\n| ^    |         |"
    );
  });

  it("Shift-Tab goes back, over the delimiter row, and stops at the first cell", () => {
    const view = makeView(TABLE, TABLE.indexOf("1"));
    run(view, previousCell);
    expect(withCaret(view)).toBe("| a   | b^       |\n| --- | ------: |\n| 1   | **two** |");
    run(view, previousCell);
    run(view, previousCell);
    expect(withCaret(view)).toBe("| a^   | b       |\n| --- | ------: |\n| 1   | **two** |");
  });

  it("Enter goes down a column, adding a row at the end", () => {
    const view = makeView(TABLE, 7);
    run(view, nextRow);
    expect(withCaret(view)).toBe("| a   | b       |\n| --- | ------: |\n| 1   | **two**^ |");
    run(view, nextRow);
    expect(withCaret(view)).toBe(
      "| a   | b       |\n| --- | ------: |\n| 1   | **two** |\n|     | ^        |"
    );
  });

  it("Enter on an empty last row takes it off and leaves the table", () => {
    const view = makeView(TABLE + "\n|   |   |");
    run(view, nextRow);
    expect(withCaret(view)).toBe(TABLE + "\n\n^");
  });

  it("does nothing outside a table", () => {
    const view = makeView("just | text", 2);
    expect(run(view, nextCell)).toBe(false);
    expect(run(view, nextRow)).toBe(false);
  });
});
