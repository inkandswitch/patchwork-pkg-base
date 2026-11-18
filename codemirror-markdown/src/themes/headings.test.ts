import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownSyntaxHighlighting, theme } from "./markdown.ts";

const themeRules = () => {
  const view = new EditorView({ state: EditorState.create({ extensions: theme("sans") }) });
  const rules = Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
  view.destroy();
  return rules;
};

describe("heading sizes", () => {
  it("are in ems of the body on the heading line, with no rem or px", () => {
    const rules = themeRules();
    for (let level = 1; level <= 6; level++) {
      const rule = new RegExp(`\\.cm-md-h${level} \\{([^}]*)\\}`).exec(rules)?.[1];
      expect(rule, `h${level}`).toBeDefined();
      expect(rule).toMatch(/font-size: var\(--studio-heading-size-\d, [\d.]+em\)/);
      expect(rule).toMatch(/line-height: [\d.]+;/);
      expect(rule).not.toMatch(/rem|px|markdown-zoom/);
    }
  });

  it("aren't set again by the highlighter, where an em would compound", () => {
    const rules = markdownSyntaxHighlighting("sans").module!.getRules();
    expect(rules).not.toMatch(/heading-size|line-height/);
  });
});
