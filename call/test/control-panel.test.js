import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { generateAutomergeUrl } from "@automerge/automerge-repo/slim";
import { freshPage, here, settle } from "./fake.js";

// happy-dom has no popovers: the menu closes itself after a choice
HTMLElement.prototype.showPopover ??= function () {};
HTMLElement.prototype.hidePopover ??= function () {};

let engine, CallControlPanel, handles, parent, element, stop;
beforeEach(async () => {
  handles = freshPage();
  engine = await import("../src/engine/call.js");
  ({ CallControlPanel } = await import("../src/control-panel.js"));
  parent = document.body.appendChild(document.createElement("div"));
  element = parent.appendChild(document.createElement("div"));
  stop = CallControlPanel(element);
});
afterEach(() => {
  stop();
  parent.remove();
  engine.hangUp();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const button = (words) => [...element.querySelectorAll("button")].find((b) => b.textContent.includes(words));

describe("its size", () => {
  test("no room at all till there's a call to show", async () => {
    expect(element.dataset.sidebarSize).toBe("none");
    const url = generateAutomergeUrl();
    const release = engine.hearRoom(url, { onScreen: true });
    await settle();
    here(handles.get(url));
    expect(element.dataset.sidebarSize).toBe("fit");
    release();
    expect(element.dataset.sidebarSize).toBe("none");
  });

  test("stopped, it takes no room", () => {
    stop();
    expect(element.dataset.sidebarSize).toBe("none");
    stop = () => {};
  });

  test("a call that couldn't be joined says so", async () => {
    await engine.join("key:" + "00".repeat(32));
    expect(element.dataset.sidebarSize).toBe("fit");
    expect(element.textContent).toContain("calls over a key aren't available yet");
  });
});

describe("a call on screen you're not in", () => {
  let url;
  beforeEach(async () => {
    url = generateAutomergeUrl();
    engine.hearRoom(url, { onScreen: true, name: "the project" });
    await settle();
    here(handles.get(url));
  });

  test("it's asked about: where, who, and joining", async () => {
    expect(element.textContent).toContain("the project");
    expect(element.textContent).toContain("ana on a call");
    button("video on").click();
    await settle();
    expect(engine.call.get()?.room).toBe(url);
  });

  test("its name takes you to it", () => {
    const opened = vi.fn();
    parent.addEventListener("patchwork:open-document", (event) => opened(event.detail.url));
    button("the project").click();
    expect(opened).toHaveBeenCalledWith(url);
  });
});

describe("in a call", () => {
  let url;
  beforeEach(async () => {
    url = generateAutomergeUrl();
    engine.hearRoom(url, { onScreen: true, name: "the project" });
    await engine.join(url);
    await settle();
  });

  test("its name takes you back to it", () => {
    const opened = vi.fn();
    parent.addEventListener("patchwork:open-document", (event) => opened(event.detail.url));
    button("the project").click();
    expect(opened).toHaveBeenCalledWith(url);
  });

  test("the menu says where faces go: in the sidebar only where there's a sidebar to show them", async () => {
    const menu = () => element.querySelector(".patchwork-call-menu");
    const items = () => [...menu().querySelectorAll("button")].map((b) => b.textContent.trim());
    expect(items()).toContain("floating");
    expect(items()).not.toContain("in the sidebar");
    expect(items().some((text) => text.includes("cursor"))).toBe(false);
    const release = engine.holdVideoSpot();
    await settle();
    expect(items()).toContain("in the sidebar");
    release();
  });

  test("choosing in the sidebar puts faces there", async () => {
    const release = engine.holdVideoSpot();
    await settle();
    const item = [...element.querySelectorAll(".patchwork-call-menu button")].find(
      (b) => b.textContent.trim() === "in the sidebar",
    );
    expect(engine.call.mode()).toBe("floating");
    item.click();
    expect(engine.call.mode()).toBe("sidebar");
    release();
  });

  test("hanging up", () => {
    element.querySelector('button[aria-label="hang up"]').click();
    expect(engine.call.get()).toBe(null);
  });
});
