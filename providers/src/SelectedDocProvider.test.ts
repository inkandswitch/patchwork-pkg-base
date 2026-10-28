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
