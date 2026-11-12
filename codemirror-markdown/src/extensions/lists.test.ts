import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownExtensions } from "./markdown";
import {
  clearDone,
  isHidingDone,
  listAt,
  moveDoneDown,
  renumber,
} from "./lists";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeView(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [markdownExtensions()],
    }),
  });
  // finish parsing now (a busy test run can leave the tree partial), and
  // dispatch so the view plugins rebuild against the whole tree.
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
  view.dispatch({});
  return view;
}

/** run a list command on the list holding `needle`, return the new doc */
function run(
  doc: string,
  needle: string,
  command: typeof renumber
): string {
  const view = makeView(doc);
  const { state } = view;
  ensureSyntaxTree(state, state.doc.length);
  const list = listAt(state, doc.indexOf(needle))!;
  view.dispatch({ changes: command(state, list) });
  return view.state.doc.toString();
}

describe("fix numbering", () => {
  it("counts up from the first number", () => {
    expect(run("1. a\n2. b\n10. c\n7. d\n", "a", renumber)).toBe(
      "1. a\n2. b\n3. c\n4. d\n"
    );
    expect(run("5) a\n1) b\n", "a", renumber)).toBe("5) a\n6) b\n");
  });

  it("keeps what's nested under an item nested when its number widens", () => {
    const doc = "8. a\n9. b\n9. c\n   - under c\n";
    expect(run(doc, "a", renumber)).toBe(
      "8. a\n9. b\n10. c\n    - under c\n"
    );
  });

  it("only touches the list it was asked about, and starts a nested one at 1", () => {
    const doc = "1. a\n    3. x\n    3. y\n5. b\n";
    expect(run(doc, "x", renumber)).toBe("1. a\n    1. x\n    2. y\n5. b\n");
  });
});

describe("done tasks", () => {
  const doc = "- [x] one\n- [ ] two\n- [x] three\n- [ ] four\n- [x] five\n\nafter";

  it("moves done tasks below the open ones, keeping their order", () => {
    expect(run(doc, "two", moveDoneDown)).toBe(
      "- [ ] two\n- [ ] four\n- [x] one\n- [x] three\n- [x] five\n\nafter"
    );
  });

  it("takes nested items along with their task", () => {
    expect(
      run("- [x] done\n    - note\n- [ ] open\n", "open", moveDoneDown)
    ).toBe("- [ ] open\n- [x] done\n    - note\n");
  });

  it("clears done tasks", () => {
    expect(run(doc, "two", clearDone)).toBe("- [ ] two\n- [ ] four\n\nafter");
    expect(run("- [x] a\n- [x] b\n", "a", clearDone)).toBe("\n");
  });
});

describe("the menu", () => {
  const items = () =>
    Array.from(document.querySelectorAll<HTMLButtonElement>(".cm-md-menu-item"));
  const rightClick = (el: Element) =>
    el.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    );

  it("opens on a list marker with what applies to that list", () => {
    const view = makeView("1. [x] a\n3. [ ] b\n\nend");
    rightClick(view.contentDOM.querySelector(".cm-md-hang")!);
    expect(items().map((b) => b.textContent)).toEqual([
      "Fix numbering",
      "Move done to bottom",
      "Clear done (1)",
      "Hide done",
    ]);
    items()[0].click();
    expect(view.state.doc.toString()).toBe("1. [x] a\n2. [ ] b\n\nend");
    expect(items()).toHaveLength(0);
  });

  it("leaves the browser's menu alone on plain text", () => {
    const view = makeView("- [x] a\n\nend");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    view.contentDOM.querySelectorAll(".cm-line")[2].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(items()).toHaveLength(0);
  });

  it("hides done tasks behind a count, and shows them again", () => {
    const view = makeView("- [x] a\n- [ ] c\n- [x] b\n- [ ] d\n\nend");
    rightClick(view.contentDOM.querySelector(".cm-md-hang")!);
    items().find((b) => b.textContent === "Hide done")!.click();
    expect(isHidingDone(view.state)).toBe(true);
    const shown = view.contentDOM.querySelectorAll(".cm-md-hidden-done");
    expect(shown).toHaveLength(1);
    expect(shown[0].textContent).toBe("2 done");
    expect(view.contentDOM.textContent).not.toContain("a");
    shown[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(isHidingDone(view.state)).toBe(false);
  });
});

describe("tab in an ordered list", () => {
  const press = (view: EditorView, key: string) =>
    runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");

  it("starts a new sub-list at 1", () => {
    const doc = "1. a\n2. b\n3. c";
    const view = makeView(doc);
    view.dispatch({ selection: { anchor: doc.indexOf("c") } });
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe("1. a\n2. b\n    1. c");
  });

  it("leaves the number alone when it joins a sub-list already there", () => {
    const doc = "1. a\n    1. x\n2. b";
    const view = makeView(doc);
    view.dispatch({ selection: { anchor: doc.indexOf("b") } });
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe("1. a\n    1. x\n    2. b");
  });
});
