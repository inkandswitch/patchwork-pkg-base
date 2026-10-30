import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { SelectedDocProvider } from "./SelectedDocProvider.js";

const URL = "automerge:3tmVsDzywTYecevUsD21YABfXKon";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
  location.hash = "";
});

function setup() {
  const host = document.createElement("div");
  const child = document.createElement("div");
  host.append(child);
  document.body.append(host);
  dispose = SelectedDocProvider(host);
  const views: unknown[] = [];
  subscribe(child, { type: "patchwork:selected-view" }, (view) => views.push(view));
  const open = (detail: object) =>
    child.dispatchEvent(
      new CustomEvent("patchwork:open-document", { bubbles: true, composed: true, detail })
    );
  return { views, open };
}

describe("SelectedDocProvider: path", () => {
  it("carries the path an open-document event names", async () => {
    const { views, open } = setup();
    open({ url: URL, path: "acct/a%2Fb" });
    await vi.waitFor(() =>
      expect(views.at(-1)).toEqual({ url: URL, toolId: null, path: "acct/a%2Fb" })
    );
  });

  it("reads path from the hash as it's encoded", async () => {
    location.hash = `doc=${URL}&path=acct/a%2Fb`;
    const { views } = setup();
    await vi.waitFor(() =>
      expect(views.at(-1)).toEqual({ url: URL, toolId: null, path: "acct/a%2Fb" })
    );
  });

  it("tells subscribers when only the path changes", async () => {
    const { views, open } = setup();
    open({ url: URL, path: "acct/x" });
    open({ url: URL, path: "acct/y" });
    await vi.waitFor(() => expect(views.at(-1)).toMatchObject({ path: "acct/y" }));
  });
});

describe("SelectedDocProvider: parts a tool selects", () => {
  const SHAPE = `${URL}/store/shape%3Aa`;
  const OTHER = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs";

  function withDocs() {
    const { open, ...rest } = setup();
    const docs: unknown[] = [];
    const child = document.body.firstElementChild!.firstElementChild! as HTMLElement;
    subscribe(child, { type: "patchwork:selected-doc" }, (urls) => docs.push(urls));
    const selectParts = (detail: object) =>
      child.dispatchEvent(
        new CustomEvent("patchwork:select-parts", { bubbles: true, composed: true, detail })
      );
    return { open, docs, selectParts, ...rest };
  }

  it("adds the parts of the open document a tool says are selected", async () => {
    const { open, docs, selectParts } = withDocs();
    open({ url: URL });
    selectParts({ url: URL, parts: [SHAPE] });
    await vi.waitFor(() => expect(docs.at(-1)).toEqual([URL, SHAPE]));
    selectParts({ url: URL, parts: [] });
    await vi.waitFor(() => expect(docs.at(-1)).toEqual([URL]));
  });

  it("ignores parts of a document that isn't open", async () => {
    const { open, docs, selectParts } = withDocs();
    open({ url: URL });
    selectParts({ url: OTHER, parts: [`${OTHER}/store/shape%3Ab`] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(docs.at(-1)).toEqual([URL]);
  });

  it("forgets the parts when another document opens", async () => {
    const { open, docs, selectParts } = withDocs();
    open({ url: URL });
    selectParts({ url: URL, parts: [SHAPE] });
    open({ url: OTHER });
    await vi.waitFor(() => expect(docs.at(-1)).toEqual([OTHER]));
  });

  it("puts the document first when what's open is a part of it", async () => {
    const { open, docs } = withDocs();
    open({ url: SHAPE });
    await vi.waitFor(() => expect(docs.at(-1)).toEqual([URL, SHAPE]));
  });

  it("lets the tool's selection replace the part that was opened", async () => {
    const { open, docs, selectParts } = withDocs();
    const HEART = `${URL}/store/shape%3Aheart`;
    open({ url: SHAPE });
    selectParts({ url: URL, parts: [HEART] });
    await vi.waitFor(() => expect(docs.at(-1)).toEqual([URL, HEART]));
    selectParts({ url: URL, parts: [] });
    await vi.waitFor(() => expect(docs.at(-1)).toEqual([URL]));
  });
});
