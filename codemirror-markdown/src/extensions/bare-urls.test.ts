import { describe, expect, it } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { bareUrls } from "./markdown.ts";

const highlighter = tagHighlighter([
  { tag: tags.url, class: "url" },
  { tag: tags.link, class: "link" },
]);

/** the highlight classes on the text `needle` in `doc` */
function classesOf(doc: string, needle: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [bareUrls] })],
  });
  const tree = ensureSyntaxTree(state, state.doc.length) ?? syntaxTree(state);
  const from = doc.indexOf(needle);
  const to = from + needle.length;
  const found = new Set<string>();
  highlightTree(tree, highlighter, (f, t, cls) => {
    if (f < to && t > from) cls.split(" ").forEach((c) => found.add(c));
  });
  return found;
}

const url = "https://example.com/a";

describe("bare urls", () => {
  it("a pasted url is a link, not code", () => {
    const c = classesOf(`see ${url} here`, url);
    expect(c.has("link")).toBe(true);
    expect(c.has("url")).toBe(false);
  });

  it("is still a link inside emphasis, lists, headings and tables", () => {
    for (const doc of [
      `*see ${url}*`,
      `- see ${url}`,
      `# see ${url}`,
      `| a |\n| - |\n| ${url} |`,
    ]) {
      const c = classesOf(doc, url);
      expect(c.has("url"), doc).toBe(false);
      expect(c.has("link"), doc).toBe(true);
    }
  });

  it("keeps the url part of link syntax as code", () => {
    for (const doc of [
      `[text](${url})`,
      `<${url}>`,
      `[ref]: ${url}`,
      `![alt](${url})`,
    ]) {
      expect(classesOf(doc, url).has("url"), doc).toBe(true);
    }
  });
});
