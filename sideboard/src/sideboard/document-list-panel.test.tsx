import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";

import { DocumentListError, isFolderDoc } from "./document-list-panel.tsx";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

describe("document-list panel errors", () => {
  it("recognizes folder-shaped documents", () => {
    expect(isFolderDoc({ title: "Root", docs: [] })).toBe(true);
    expect(isFolderDoc({ title: "Not a folder" } as any)).toBe(false);
    expect(isFolderDoc(undefined)).toBe(false);
  });

  it("renders visible error details", () => {
    const root = document.createElement("div");
    document.body.append(root);

    dispose = render(
      () => (
        <DocumentListError
          message="Could not load root folder."
          detail="automerge:missing"
        />
      ),
      root
    );

    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not load root folder."
    );
    expect(root.textContent).toContain("automerge:missing");
  });
});
