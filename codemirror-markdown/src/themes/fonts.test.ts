import { describe, expect, it } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import { markdownSyntaxHighlighting } from "./markdown.ts";
import { bareUrls } from "../extensions/markdown.ts";

const BODY = "var(--text-editor-family-sans)";
const CODE = "var(--text-editor-family-code)";

/**
 * The font-family the highlighter puts on `needle`: the last rule in the
 * style module, among the classes on that span, that sets one. `null` means
 * no highlight class sets a font, so it falls through to `.cm-content` — which
 * the patchwork theme sets to the code font.
 */
function fontOf(doc: string, needle: string) {
  const style = markdownSyntaxHighlighting("sans");
  const rules = style.module!.getRules();
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [bareUrls] })],
  });
  const tree = ensureSyntaxTree(state, state.doc.length)!;
  const from = doc.indexOf(needle);
  let classes: string[] = [];
  highlightTree(tree, style, (f, t, cls) => {
    if (f <= from && t > from) classes = cls.split(" ");
  });
  let font: string | null = null;
  for (const m of rules.matchAll(/\.([^\s{.]+) \{([^}]*)\}/g)) {
    const family = /font-family: ([^;]+)/.exec(m[2]);
    if (family && classes.includes(m[1])) font = family[1].trim();
  }
  return font;
}

describe("fonts", () => {
  it("plain paragraph text is the body font", () => {
    expect(fontOf("just words", "words")).toBe(BODY);
  });

  it("bold, italic and struck text are the body font", () => {
    expect(fontOf("a **bold** b", "bold")).toBe(BODY);
    expect(fontOf("a *slanty* b", "slanty")).toBe(BODY);
    expect(fontOf("a _slanty_ b", "slanty")).toBe(BODY);
    expect(fontOf("a ~~gone~~ b", "gone")).toBe(BODY);
    expect(fontOf("a ***both*** b", "both")).toBe(BODY);
  });

  it("link text and bare urls are the body font", () => {
    expect(fontOf("a [words](https://x.com) b", "words")).toBe(BODY);
    expect(fontOf("see https://x.com/a here", "https")).toBe(BODY);
  });

  it("the url inside link syntax, and inline code, stay code", () => {
    expect(fontOf("a [words](https://x.com) b", "https")).toBe(CODE);
    expect(fontOf("a `code` b", "code")).toBe(CODE);
    expect(fontOf("a **`code`** b", "code")).toBe(CODE);
    expect(fontOf("a [`code`](https://x.com) b", "code")).toBe(CODE);
  });
});
