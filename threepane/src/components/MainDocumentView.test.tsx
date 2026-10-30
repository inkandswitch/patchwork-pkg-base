import { afterEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { MainDocumentView } from "./MainDocumentView";

const URL = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
});

describe("MainDocumentView", () => {
  it("hands the tool the path the document was opened at, without remounting it", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const [path, setPath] = createSignal<string | undefined>("acct/a%2Fb");
    dispose = render(
      () => (
        <MainDocumentView
          viewKey={() => URL}
          selectedDocUrl={() => URL}
          toolId={() => "editor"}
          path={path}
        />
      ),
      container
    );
    const view = container.querySelector("patchwork-view")!;
    expect(view.getAttribute("path")).toBe("acct/a%2Fb");
    setPath("acct/c");
    expect(container.querySelector("patchwork-view")).toBe(view);
    expect(view.getAttribute("path")).toBe("acct/c");
  });
});
