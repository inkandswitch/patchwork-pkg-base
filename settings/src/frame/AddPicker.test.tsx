import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { AddPicker } from "./AddPicker";

const options = [
  { id: "comments", name: "Comments" },
  { id: "history", name: "History" },
  { id: "outline", name: "Outline" },
];

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

function mount(list = options) {
  const onPick = vi.fn();
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <AddPicker options={list} onPick={onPick} />, root);
  const menu = root.querySelector<HTMLElement>(".settings-picker")!;
  // happy-dom has no popover api: stand in for it, toggle event and all
  let open = false;
  const set = (next: boolean) => {
    open = next;
    menu.dispatchEvent(
      Object.assign(new Event("toggle"), { newState: next ? "open" : "closed" })
    );
  };
  menu.togglePopover = () => (set(!open), !open);
  menu.hidePopover = () => set(false);
  const input = root.querySelector<HTMLInputElement>("input")!;
  const type = (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const key = (key: string) =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  const items = () =>
    [...root.querySelectorAll(".settings-picker-item")].map((el) =>
      el.textContent?.trim()
    );
  root.querySelector<HTMLButtonElement>(".settings-button")!.click();
  return { onPick, type, key, items, isOpen: () => open };
}

describe("AddPicker", () => {
  it("filters what's offered by what's typed, and enter adds the highlighted one", () => {
    const { onPick, type, key, items, isOpen } = mount();
    expect(isOpen()).toBe(true);
    expect(items()).toEqual(["Comments", "History", "Outline"]);
    type("o");
    expect(items()).toEqual(["Comments", "History", "Outline"]);
    type("out");
    expect(items()).toEqual(["Outline"]);
    type("");
    key("ArrowDown");
    key("Enter");
    expect(onPick).toHaveBeenCalledWith("history");
    expect(isOpen()).toBe(false);
  });

  it("adds what was typed as a tool id when nothing matches", () => {
    const { onPick, type, key, items } = mount();
    type("  my-tool ");
    expect(items()).toEqual(["Add my-tool"]);
    key("Enter");
    expect(onPick).toHaveBeenCalledWith("my-tool");
  });

  it("says when there's nothing left to add", () => {
    mount([]);
    expect(
      document.querySelector(".settings-picker-empty")?.textContent
    ).toMatch(/already here/);
  });
});
