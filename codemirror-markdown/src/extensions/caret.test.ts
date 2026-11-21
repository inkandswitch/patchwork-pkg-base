import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { caretMarks } from "./caret";

// `|` marks the caret.
const at = (text: string) => {
  const pos = text.indexOf("|");
  const state = EditorState.create({
    doc: text.slice(0, pos) + text.slice(pos + 1),
    extensions: [markdown({ base: markdownLanguage })],
  });
  return caretMarks(state, pos);
};

const plain = { bold: false, italic: false, strike: false, code: false };
const bold = { ...plain, bold: true };
const italic = { ...plain, italic: true };
const strike = { ...plain, strike: true };
const code = { ...plain, code: true };

describe("caretMarks", () => {
  it("is plain in plain text", () => {
    expect(at("hello| there")).toEqual(plain);
  });

  it("is bold inside strong text, at either edge", () => {
    expect(at("a **bo|ld** b")).toEqual(bold);
    expect(at("a **|bold** b")).toEqual(bold);
    expect(at("a **bold|** b")).toEqual(bold);
  });

  it("is plain just outside the marks", () => {
    expect(at("a |**bold** b")).toEqual(plain);
    expect(at("a **bold**| b")).toEqual(plain);
    expect(at("a *|*bold** b")).toEqual(plain);
  });

  it("is italic inside emphasis", () => {
    expect(at("a _ita|lic_ b")).toEqual(italic);
    expect(at("a *ita|lic* b")).toEqual(italic);
    expect(at("a _italic_| b")).toEqual(plain);
  });

  it("is both when nested", () => {
    expect(at("**_bo|th_**")).toEqual({ ...plain, bold: true, italic: true });
    expect(at("***bo|th***")).toEqual({ ...plain, bold: true, italic: true });
  });

  it("is bold in a heading after its marker", () => {
    expect(at("# Hea|ding")).toEqual(bold);
    expect(at("## |Heading")).toEqual(bold);
    expect(at("#|# Heading")).toEqual(plain);
    expect(at("# _He|ading_")).toEqual({ ...plain, bold: true, italic: true });
  });

  it("is bold in a setext heading's text, not its underline", () => {
    expect(at("Hea|ding\n===")).toEqual(bold);
    expect(at("Heading\n=|==")).toEqual(plain);
  });

  it("is struck through inside strikethrough", () => {
    expect(at("a ~~gon|e~~ b")).toEqual(strike);
    expect(at("a ~~|gone~~ b")).toEqual(strike);
    expect(at("a ~~gone~~| b")).toEqual(plain);
    expect(at("~~**bo|th**~~")).toEqual({ ...plain, bold: true, strike: true });
  });

  it("is code inside inline code", () => {
    expect(at("a `co|de` b")).toEqual(code);
    expect(at("a `|code` b")).toEqual(code);
    expect(at("a `code`| b")).toEqual(plain);
    expect(at("a ``co|de`` b")).toEqual(code);
  });

  it("is code in a fenced block's body, not on its fences", () => {
    expect(at("```js\nle|t x\n```")).toEqual(code);
    expect(at("```js\nlet x|\n```")).toEqual(code);
    expect(at("```j|s\nlet x\n```")).toEqual(plain);
    expect(at("```js\nlet x\n`|``")).toEqual(plain);
    expect(at("```\n|")).toEqual(code);
  });

  it("is code in an indented block", () => {
    expect(at("para\n\n    co|de")).toEqual(code);
  });
});
