import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { accept } from "@inkandswitch/patchwork-providers";

const [tagged, setTagged] = createSignal<{ id: string; name: string }[]>([]);
vi.mock("../hooks", () => ({ useTaggedComponents: () => tagged }));

const { CallVideoOpener } = await import("./CallVideoOpener");

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

let host: HTMLElement;
let dispose: () => void;
let respond: ((value: { wanted: boolean }) => void) | null;
let subscribed: number;
let selectors: any[];
const [collapsed, setCollapsed] = createSignal(false);
const [selected, setSelected] = createSignal<string | undefined>(
  "comments-view"
);
const open = vi.fn((id: string) => setSelected(id));
const select = vi.fn((id: string | undefined) => setSelected(id));

beforeEach(() => {
  respond = null;
  subscribed = 0;
  selectors = [];
  setCollapsed(false);
  open.mockClear();
  select.mockClear();
  setSelected("comments-view");
  setTagged([
    { id: "comments-view", name: "Comments" },
    { id: "call-video", name: "Call" },
  ]);
  host = document.body.appendChild(document.createElement("div"));
  host.addEventListener("patchwork:subscribe", (event: any) => {
    if (event.detail.selector.type !== "patchwork:call-video") return;
    subscribed++;
    selectors.push(event.detail.selector);
    accept(event, (r: any) => {
      respond = r;
      // (an unsubscribe arrives over a port: maybe after the next test's begun)
      return () => {
        if (respond === r) respond = null;
      };
    });
  });
});
afterEach(() => {
  dispose?.();
  host.remove();
});

function mount() {
  dispose = render(
    () => (
      <CallVideoOpener
        selected={selected}
        select={select}
        open={open}
        isCollapsed={collapsed}
      />
    ),
    host.appendChild(document.createElement("div"))
  );
}

describe("the call's video tab", () => {
  it("is opened when the video's wanted", async () => {
    mount();
    await settle();
    respond!({ wanted: true });
    await settle();
    expect(open).toHaveBeenCalledWith("call-video");
  });

  it("goes back to the tab that was showing when it isn't", async () => {
    mount();
    await settle();
    respond!({ wanted: true });
    await settle();
    respond!({ wanted: false });
    await settle();
    expect(select).toHaveBeenCalledWith("comments-view");
  });

  it("goes back to no tab chosen (the first) if none was", async () => {
    setSelected(undefined);
    mount();
    await settle();
    respond!({ wanted: true });
    await settle();
    respond!({ wanted: false });
    await settle();
    expect(select).toHaveBeenCalledWith(undefined);
  });

  it("leaves the tab alone if you've moved on from it", async () => {
    mount();
    await settle();
    respond!({ wanted: true });
    await settle();
    setSelected("history-view");
    respond!({ wanted: false });
    await settle();
    expect(select).not.toHaveBeenCalled();
  });

  it("asks again when the call's provider turns up", async () => {
    mount();
    await settle();
    expect(subscribed).toBe(1);
    window.dispatchEvent(
      new CustomEvent("patchwork:mounted", {
        detail: { componentId: "call-provider" },
      })
    );
    await settle();
    expect(subscribed).toBe(2);
  });

  it("says whether the video's showing: the sidebar open, on its tab", async () => {
    mount();
    await settle();
    expect(selectors.at(-1)).toEqual({
      type: "patchwork:call-video",
      showing: false,
    });
    respond!({ wanted: true });
    await settle();
    expect(selectors.at(-1)).toEqual({
      type: "patchwork:call-video",
      showing: true,
    });
    setCollapsed(true);
    await settle();
    expect(selectors.at(-1)).toEqual({
      type: "patchwork:call-video",
      showing: false,
    });
  });

  it("isn't asked about without a call video tab", async () => {
    setTagged([{ id: "comments-view", name: "Comments" }]);
    mount();
    await settle();
    expect(subscribed).toBe(0);
  });
});
