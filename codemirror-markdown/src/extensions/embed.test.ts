import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  generateAutomergeUrl,
  parseAutomergeUrl,
} from "@automerge/automerge-repo/slim";
import { markdownEmbed } from "./embed";

type Created = { url: string; doc: Record<string, unknown> };

let created: Created[];

beforeEach(() => {
  created = [];
  (window as any).repo = {
    create() {
      const entry: Created = { url: generateAutomergeUrl(), doc: {} };
      created.push(entry);
      return {
        url: entry.url,
        change(fn: (d: any) => void) {
          fn(entry.doc);
        },
      };
    },
  };
});

afterEach(() => {
  delete (window as any).repo;
  document.body.innerHTML = "";
});

function makeView(doc: string, from: number, to = from) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(from, to),
      extensions: markdownEmbed(),
    }),
  });
}

function paste(
  view: EditorView,
  { files = [], text = "" }: { files?: File[]; text?: string }
) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const data: Record<string, string> = text ? { "text/plain": text } : {};
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      types: [...Object.keys(data), ...(files.length ? ["Files"] : [])],
      getData: (type: string) => data[type] ?? "",
    },
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

const png = () =>
  new File([new Uint8Array([137, 80, 78, 71])], "image.png", {
    type: "image/png",
  });

const settle = () => new Promise((r) => setTimeout(r, 20));

const idOf = (c: Created) => parseAutomergeUrl(c.url as any).documentId;

describe("pasting images", () => {
  it("imports a pasted image as a file doc and embeds it", async () => {
    const view = makeView("", 0);
    paste(view, { files: [png()] });

    await vi.waitFor(() => expect(created).toHaveLength(1));
    const [file] = created;
    expect(file.doc).toMatchObject({
      "@patchwork": { type: "file" },
      mimeType: "image/png",
      extension: "png",
      name: "image.png",
    });
    expect(file.doc.content).toBeInstanceOf(Uint8Array);

    await vi.waitFor(() =>
      expect(view.state.doc.toString()).toBe(`[patchwork:${idOf(file)}]`)
    );
  });

  it("replaces the selection and puts the embed on its own line", async () => {
    const view = makeView("before XXX after", 7, 10);
    paste(view, { files: [png()] });

    await vi.waitFor(() => expect(created).toHaveLength(1));
    await vi.waitFor(() =>
      expect(view.state.doc.toString()).toBe(
        `before \n[patchwork:${idOf(created[0])}]\n after`
      )
    );
  });

  it("pastes the text when the clipboard also carries text", async () => {
    // e.g. rich text from an office app, which also attaches a picture of it
    const view = makeView("", 0);
    paste(view, { files: [png()], text: "hello" });
    await settle();
    expect(created).toHaveLength(0);
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("ignores pasted files that aren't images", async () => {
    const view = makeView("", 0);
    const pdf = new File(["%PDF"], "a.pdf", { type: "application/pdf" });
    paste(view, { files: [pdf] });
    await settle();
    expect(created).toHaveLength(0);
    expect(view.state.doc.toString()).toBe("");
  });
});

function drop(view: EditorView, pos: number, files: File[]) {
  // happy-dom has no layout, so pin where the drop lands.
  vi.spyOn(view, "posAtCoords").mockReturnValue(pos);
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files,
      types: ["Files"],
      getData: () => "",
    },
  });
  view.contentDOM.dispatchEvent(event);
}

describe("dropping files from the desktop", () => {
  it("imports each dropped file as a file doc and embeds them", async () => {
    const view = makeView("ab", 0);
    const md = new File(["# hi"], "notes.md", { type: "text/markdown" });
    drop(view, 1, [png(), md]);

    await vi.waitFor(() => expect(created).toHaveLength(2));
    expect(created[0].doc).toMatchObject({ name: "image.png" });
    expect(created[1].doc).toMatchObject({
      name: "notes.md",
      extension: "md",
      content: "# hi",
    });

    const [a, b] = created.map(idOf);
    await vi.waitFor(() =>
      expect(view.state.doc.toString()).toBe(
        `a\n[patchwork:${a}]\n\n[patchwork:${b}]\nb`
      )
    );
  });
});

describe("rendering embeds", () => {
  const docId = () => parseAutomergeUrl(generateAutomergeUrl()).documentId;

  function withDoc(doc: Record<string, unknown>) {
    (window as any).repo.find = async () => ({
      doc: () => doc,
      on() {},
      off() {},
    });
  }

  const imageDoc = {
    "@patchwork": { type: "file" },
    content: new Uint8Array([137, 80, 78, 71]),
    mimeType: "image/png",
    extension: "png",
    name: "cat.png",
  };

  it("draws an image doc as a bare img, with no frame", async () => {
    withDoc(imageDoc);
    const view = makeView(`[patchwork:${docId()}]`, 0);
    await vi.waitFor(() =>
      expect(view.dom.querySelector(".cm-embed-image > img")).not.toBeNull()
    );
    expect(view.dom.querySelector("patchwork-view")).toBeNull();
    expect(view.dom.querySelector(".cm-embed img")!.getAttribute("alt")).toBe("cat.png");
  });

  it("frames docs that aren't images", async () => {
    withDoc({ "@patchwork": { type: "file" }, content: "# hi", extension: "md" });
    const view = makeView(`[patchwork:${docId()}]`, 0);
    await vi.waitFor(() =>
      expect(view.dom.querySelector('patchwork-view[tool-id="embed"]')).not.toBeNull()
    );
    expect(view.dom.querySelector(".cm-embed img")).toBeNull();
  });

  it("frames an image when a tool is pinned", async () => {
    withDoc(imageDoc);
    const view = makeView(`[patchwork:${docId()}/raw]`, 0);
    const pv = view.dom.querySelector("patchwork-view");
    expect(pv?.getAttribute("embed-tool-id")).toBe("raw");
    await settle();
    expect(view.dom.querySelector(".cm-embed img")).toBeNull();
  });

  describe("scrolling back to an embed", () => {
    // CodeMirror throws a line's DOM away when it scrolls out of view and
    // calls toDOM again when it comes back. If the remounted embed waited on
    // repo.find it would start 0px tall and then grow, jumping the text.
    const neverLoads = () => {
      (window as any).repo.find = () => new Promise(() => {});
    };

    it("draws a seen image straight away, at its known size", async () => {
      withDoc(imageDoc);
      const id = docId();
      makeView(`[patchwork:${id}]`, 0);
      let img: HTMLImageElement | null = null;
      await vi.waitFor(() => {
        img = document.querySelector(".cm-embed-image > img");
        expect(img).not.toBeNull();
      });
      Object.defineProperty(img, "naturalWidth", { value: 640 });
      Object.defineProperty(img, "naturalHeight", { value: 480 });
      img!.dispatchEvent(new Event("load"));
      document.body.innerHTML = "";

      neverLoads();
      const view = makeView(`[patchwork:${id}]`, 0);
      const again = view.dom.querySelector(".cm-embed-image > img")!;
      expect(again).not.toBeNull();
      expect(again.getAttribute("src")).toBe(img!.getAttribute("src"));
      expect(again.getAttribute("width")).toBe("640");
      expect(again.getAttribute("height")).toBe("480");
    });

    it("frames a seen non-image straight away", async () => {
      withDoc({ "@patchwork": { type: "file" }, content: "# hi" });
      const id = docId();
      makeView(`[patchwork:${id}]`, 0);
      await vi.waitFor(() =>
        expect(document.querySelector("patchwork-view")).not.toBeNull()
      );
      document.body.innerHTML = "";

      neverLoads();
      const view = makeView(`[patchwork:${id}]`, 0);
      expect(view.dom.querySelector("patchwork-view")).not.toBeNull();
    });
  });
});
