import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { SidebarWidgets } from "./SidebarWidgets";
import type { ToolSlot } from "../types";

// the real one defines <patchwork-view> against a repo; the layout doesn't need it
vi.mock("@inkandswitch/patchwork-elements", () => ({}));

let host: HTMLElement;
let dispose: () => void;
afterEach(() => {
  dispose?.();
  host?.remove();
});

function mount(widgets: ToolSlot[], ready = true) {
  host = document.body.appendChild(document.createElement("div"));
  dispose = render(
    () => (
      <SidebarWidgets
        widgets={() => widgets}
        configHandle={() => undefined}
        rootFolderUrl={() => undefined}
        ready={() => ready}
      />
    ),
    host
  );
  // (solid sets a custom element's `component` as a property, as SlotView's)
  return [...host.querySelectorAll("patchwork-view")].filter(
    (view) => (view as any).component === "call-control-panel"
  );
}

describe("the call's control panel, in the sidebar", () => {
  it("is there, last, after the configured widgets", () => {
    const panels = mount([["chee/document-list", "automerge:r" as any]]);
    expect(panels).toHaveLength(1);
    const views = [...host.querySelectorAll(".threepane-widget > patchwork-view")];
    expect(views.at(-1)).toBe(panels[0]);
  });

  it("is there with no widgets configured", () => {
    expect(mount([])).toHaveLength(1);
  });

  it("is only there once if it's configured as a widget too", () => {
    expect(mount(["call-control-panel"])).toHaveLength(1);
  });

  it("waits, as the widgets do, for the main document", () => {
    expect(mount([], false)).toHaveLength(0);
  });
});
