import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { markdownLinks, urlAt } from "./links";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const doc =
  "see [text](https://a.com) and <https://b.com> and https://c.com [ref][r]\n\n[r]: https://d.com";

function state(text = doc) {
  return EditorState.create({
    doc: text,
    extensions: [markdown({ base: markdownLanguage })],
  });
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
  function mousedown(view: EditorView, init: MouseEventInit) {
    vi.spyOn(view, "posAtCoords").mockReturnValue(6);
    // happy-dom has no layout, so stub the measuring CodeMirror's own
    // click-to-place-cursor does when we let a click through.
    vi.spyOn(view, "posAndSideAtCoords").mockReturnValue({ pos: 6, assoc: 1 });
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    });
    view.contentDOM.dispatchEvent(event);
    return event;
  }

  it("opens the link under the pointer when the modifier is held", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const view = makeView();
    const event = mousedown(view, { metaKey: true, ctrlKey: true });
    expect(open).toHaveBeenCalledWith(
      "https://a.com",
      "_blank",
      "noopener,noreferrer"
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a plain click alone", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mousedown(makeView(), {});
    expect(open).not.toHaveBeenCalled();
  });

  it("opens automerge links inside patchwork", () => {
    const url = "automerge:2j9knpCseyhnK8izDmLpGP5WMdZQ";
    const view = makeView(`[doc](${url})`);
    const opened = vi.fn();
    document.addEventListener("patchwork:open-document", (e) =>
      opened((e as CustomEvent).detail.url)
    );
    vi.spyOn(view, "posAtCoords").mockReturnValue(2);
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        metaKey: true,
        ctrlKey: true,
      })
    );
    expect(opened).toHaveBeenCalledWith(url);
  });

  it("flags the editor while the modifier is held", () => {
    const view = makeView();
    const key = (type: string, held: boolean) =>
      view.contentDOM.dispatchEvent(
        new KeyboardEvent(type, { bubbles: true, metaKey: held, ctrlKey: held })
      );
    key("keydown", true);
    expect(view.dom.classList.contains("cm-mod-held")).toBe(true);
    key("keyup", false);
    expect(view.dom.classList.contains("cm-mod-held")).toBe(false);
  });

  it("marks raw links so they can be styled", () => {
    const view = makeView();
    const marked = Array.from(
      view.contentDOM.querySelectorAll(".cm-md-link")
    ).map((el) => el.textContent);
    expect(marked).toContain("[text](https://a.com)");
  });
});
