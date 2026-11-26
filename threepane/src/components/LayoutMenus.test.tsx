import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ContextTabs } from "./ContextTabs";
import { FrameTopBar } from "./FrameTopBar";
import { EDIT_LAYOUT_EVENT, type LayoutEdit } from "../layoutEdits";
import type { ToolSlot } from "../types";

vi.mock("@inkandswitch/patchwork-elements", () => ({}));
vi.mock("@inkandswitch/patchwork-plugins", () => ({
  getRegistry: () => ({ get: () => undefined, on: () => () => {} }),
}));
vi.mock("./DocumentTitle", () => ({ DocumentTitle: () => null }));

let host: HTMLElement;
let dispose: () => void;
let edits: LayoutEdit[];
afterEach(() => {
  dispose?.();
  host?.remove();
  document.querySelectorAll(".threepane-menu").forEach((m) => m.remove());
});

function mount(ui: () => any) {
  edits = [];
  host = document.body.appendChild(document.createElement("div"));
  host.addEventListener(EDIT_LAYOUT_EVENT, (e) =>
    edits.push((e as CustomEvent<LayoutEdit>).detail)
  );
  dispose = render(ui, host);
}

function rightClick(target: Element) {
  target.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true })
  );
}

const menuItems = () =>
  [...document.querySelectorAll<HTMLButtonElement>('.threepane-menu [role="menuitem"]')];

describe("the context tab bar's menu", () => {
  const tabs = (hidden: { id: string; name: string }[] = []) =>
    mount(() => (
      <ContextTabs
        items={() => [
          { id: "comments", name: "Comments" },
          { id: "drafts", name: "Drafts" },
        ]}
        hidden={() => hidden}
        addable={() => []}
        selectedToolId={() => undefined}
        setSelectedToolId={() => {}}
      />
    ));

  it("copies, hides and removes a tab", () => {
    tabs();
    rightClick(host.querySelector('[data-tool-id="drafts"]')!);
    expect(menuItems().map((b) => b.textContent)).toEqual([
      "Copy tool id",
      "Hide",
      "Remove",
    ]);
    menuItems()[2].click();
    expect(edits).toEqual([{ lane: "context", action: "remove", id: "drafts" }]);
  });

  it("shows a hidden tab again", () => {
    tabs([{ id: "notes", name: "Notes" }]);
    rightClick(host.querySelector(".context-sidebar__add")!);
    expect(menuItems().map((b) => b.textContent)).toEqual(["Show Notes"]);
    menuItems()[0].click();
    expect(edits).toEqual([{ lane: "context", action: "show", id: "notes" }]);
  });

  it("leaves the browser's menu alone with nothing to offer", () => {
    tabs();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    host.querySelector(".context-sidebar__add")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("the top bar's doctitle tools", () => {
  const bar = (tools: ToolSlot[], hidden: string[]) =>
    mount(() => (
      <FrameTopBar
        docUrl={() => "automerge:doc" as any}
        toolSlots={() => tools}
        hiddenTools={() => hidden}
        isLeftCollapsed={() => false}
        hasContext={() => false}
        isRightCollapsed={() => false}
        onToggleRight={() => {}}
      />
    ));

  it("leave out the hidden ones, which the bar's menu can show", () => {
    bar(["doc-openwith", "sync-indicator"], ["sync-indicator"]);
    const ids = [...host.querySelectorAll("[data-tool-id]")].map((el) =>
      el.getAttribute("data-tool-id")
    );
    expect(ids).toEqual(["doc-openwith"]);

    rightClick(host.querySelector(".threepane__spacer")!);
    expect(menuItems().map((b) => b.textContent)).toEqual(["Show sync-indicator"]);
  });

  it("can each be removed", () => {
    bar(["doc-openwith"], []);
    rightClick(host.querySelector('[data-tool-id="doc-openwith"]')!);
    menuItems().find((b) => b.textContent === "Remove")!.click();
    expect(edits).toEqual([
      { lane: "doctitle", action: "remove", id: "doc-openwith" },
    ]);
  });
});
