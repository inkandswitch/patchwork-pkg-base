import { afterEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import Item from "./item.tsx";

const DOC_URL = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
});

describe("Item", () => {
  it("renders a row the browser will actually let you drag", () => {
    const container = document.createElement("div");
    document.body.append(container);
    dispose = render(
      () => (
        <Item
          aria-label="Notes"
          id="row"
          url={DOC_URL}
          name="Notes"
          type="md"
          pressed={false}
          openWith={() => {}}
          startRenaming={() => {}}
          remove={() => {}}
          element={{} as any}
          repo={{} as any}
          rootFolderHandle={{} as any}
        >
          Notes
        </Item>
      ),
      container
    );

    const row = container.querySelector("[data-dnd-item]")!;
    expect(row.getAttribute("draggable")).toBe("true");
  });
});
