import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownLinks, urlAt } from "./links";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const doc =
  "see [text](https://a.com) and <https://b.com> and https://c.com [ref][r]\n\n[r]: https://d.com";

function state(text = doc) {
  const state = EditorState.create({
    doc: text,
    extensions: [markdown({ base: markdownLanguage })],
  });
  // a busy test run can leave the tree partial; finish it.
  ensureSyntaxTree(state, state.doc.length, 10_000);
  return state;
}

function makeView(text = doc) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      // Cursor inside the first link, so it shows as raw markdown.
      selection: { anchor: 6 },
      extensions: [markdown({ base: markdownLanguage }), markdownLinks()],
    }),
  });
}

describe("urlAt", () => {
  const at = (needle: string, offset = 1) =>
    urlAt(state(), doc.indexOf(needle) + offset);

  it("finds the url of an inline link from its text or its url", () => {
    expect(at("text")).toBe("https://a.com");
    expect(at("https://a.com")).toBe("https://a.com");
  });

  it("finds autolinks, bare urls and reference definitions", () => {
    expect(at("<https://b.com>")).toBe("https://b.com");
    expect(at("https://c.com")).toBe("https://c.com");
    expect(at("https://d.com")).toBe("https://d.com");
  });

  it("is null off a link, and for reference-style links", () => {
    expect(at("see")).toBeNull();
    expect(at("[ref]")).toBeNull();
  });
});

describe("mod-click", () => {
  const mod = { metaKey: true, ctrlKey: true };

  // happy-dom has no layout: pretend the pointer is over `pos`, which is
  // drawn right where the pointer is.
  function pointAt(view: EditorView, pos: number) {
    vi.spyOn(view, "posAtCoords").mockReturnValue(pos);
    vi.spyOn(view, "posAndSideAtCoords").mockReturnValue({ pos, assoc: 1 });
    vi.spyOn(view, "coordsAtPos").mockReturnValue({
      left: 10,
      right: 10,
      top: 0,
      bottom: 20,
    });
  }

  const mouse = (view: EditorView, type: string, init: MouseEventInit = {}) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 10,
      clientY: 10,
      ...init,
    });
    view.contentDOM.dispatchEvent(event);
    return event;
  };

  const hovered = (view: EditorView) =>
    Array.from(view.contentDOM.querySelectorAll(".cm-md-link-hover")).map(
      (el) => el.textContent
    );

  it("opens the link under the pointer when the modifier is held", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const view = makeView();
    pointAt(view, 6);
    const event = mouse(view, "mousedown", mod);
    expect(open).toHaveBeenCalledWith(
      "https://a.com",
      "_blank",
      "noopener,noreferrer"
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a plain click alone", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const view = makeView();
    pointAt(view, 6);
    mouse(view, "mousedown");
    expect(open).not.toHaveBeenCalled();
  });

  it("ignores a link the pointer is only near", () => {
    const view = makeView();
    pointAt(view, 6);
    // e.g. the blank space past the end of a line the link ends
    mouse(view, "mousemove", { ...mod, clientX: 300 });
    expect(hovered(view)).toEqual([]);
    mouse(view, "mousemove", mod);
    expect(hovered(view)).toEqual(["[text](https://a.com)"]);
  });

  it("opens automerge links inside patchwork", () => {
    const url = "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ";
    const view = makeView(`[doc](${url})`);
    const opened = vi.fn();
    document.addEventListener("patchwork:open-document", (e) =>
      opened((e as CustomEvent).detail.url)
    );
    pointAt(view, 2);
    mouse(view, "mousedown", mod);
    expect(opened).toHaveBeenCalledWith(url);
  });

  it("underlines only the hovered link, only while the modifier is held", () => {
    const view = makeView();
    pointAt(view, doc.indexOf("https://b.com"));
    mouse(view, "mousemove");
    expect(hovered(view)).toEqual([]);

    mouse(view, "mousemove", mod);
    expect(hovered(view)).toEqual(["<https://b.com>"]);

    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keyup", { bubbles: true })
    );
    expect(hovered(view)).toEqual([]);

    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, ...mod })
    );
    expect(hovered(view)).toEqual(["<https://b.com>"]);

    mouse(view, "mouseleave", mod);
    expect(hovered(view)).toEqual([]);
  });
});
