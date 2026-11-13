import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { accept } from "@inkandswitch/patchwork-providers";
import { settle } from "./fake.js";

// the button knows the call only by asking: a provider that answers by hand
let host, element, stop, respond, asked, sent;
beforeEach(async () => {
  respond = null;
  asked = null;
  sent = [];
  host = document.body.appendChild(document.createElement("div"));
  host.addEventListener("patchwork:call", (event) => sent.push(event.detail));
  element = host.appendChild(document.createElement("div"));
  stop = () => {};
});
afterEach(() => {
  stop();
  host.remove();
});

async function mount({ answering = true } = {}) {
  if (answering) {
    host.addEventListener("patchwork:subscribe", (event) => {
      asked = event.detail.selector;
      accept(event, (r) => {
        respond = r;
        return () => {};
      });
    });
  }
  const { default: CallDoctitleButton } = await import("../src/button.js");
  stop = CallDoctitleButton({ url: "automerge:doc" }, element);
  await settle();
}
const button = () => element.querySelector("button");
const say = async (state) => {
  respond({ here: false, others: 0, elsewhere: false, ...state });
  await settle();
};

test("without a provider, nothing", async () => {
  await mount({ answering: false });
  expect(button()).toBe(null);
});

test("it asks about its own doc", async () => {
  await mount();
  expect(asked).toEqual({ type: "patchwork:call", url: "automerge:doc" });
  expect(button()).toBe(null);
});

test("nobody on: call everyone here, which asks", async () => {
  await mount();
  await say({});
  expect(button().dataset.state).toBe("call");
  expect(button().getAttribute("aria-label")).toBe("call everyone here");
  button().click();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ action: "ask", url: "automerge:doc" });
  expect(sent[0].at).toEqual({ x: expect.any(Number), y: expect.any(Number) });
});

test("some on: join, saying how many", async () => {
  await mount();
  await say({ others: 2 });
  expect(button().dataset.state).toBe("join");
  expect(button().getAttribute("aria-label")).toBe("join the call");
  expect(button().textContent).toContain("2");
});

test("in it: hang up", async () => {
  await mount();
  await say({ here: true, others: 1 });
  expect(button().dataset.state).toBe("here");
  expect(button().getAttribute("aria-label")).toBe("hang up");
  button().click();
  expect(sent).toEqual([{ action: "hang-up" }]);
});
