import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { theme } from "./markdown.ts";

const themeRules = () => {
  const view = new EditorView({ state: EditorState.create({ extensions: theme("serif") }) });
  const rules = Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
  view.destroy();
  return rules;
};

describe("reading width", () => {
  it("the scroller is the container the content measures itself against", () => {
    // all of them: codemirror's base theme has one of its own.
    const scroller = [...themeRules().matchAll(/\.cm-scroller \{([^}]*)\}/g)]
      .map((m) => m[1])
      .join(" ");
    expect(scroller).toMatch(/container-type: inline-size/);
    // so the query's `ex` is the body text's, not codemirror's monospace.
    expect(scroller).toMatch(/font-family: var\(--text-editor-family-serif/);
  });

  it("drops the inline padding under reading width, keeping the hang", () => {
    const query = /@container \(width < 100ex\) \{[^{]*\.cm-content \{([^}]*)\}/.exec(
      themeRules()
    )?.[1];
    expect(query).toBeDefined();
    expect(query).toMatch(/padding-inline: 0/);
    expect(query).toMatch(/padding-left: var\(--markdown-hang, 0px\)/);
  });
});
