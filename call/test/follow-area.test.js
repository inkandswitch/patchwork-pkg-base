import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { Repo, initSubduction } from "@automerge/automerge-repo";
import { freshPage, tick } from "./fake.js";

const KEY = "lattice-wm:call";
// subscriptions answer over a MessagePort: a few turns to arrive
const settle = async () => {
  for (let i = 0; i < 8; i++) await tick();
};

beforeAll(() => initSubduction());

let engine, follow, providers, followAreas, handles, room, frame, area, stopAreas, unrender, base, docA, docB;
beforeEach(async () => {
  handles = freshPage();
  engine = await import("../src/engine/call.js");
  follow = await import("../src/engine/follow.js");
  providers = await import("@inkandswitch/patchwork-providers");
  ({ followAreas } = await import("../src/follow-area.js"));
  // (solid as the modules just imported have it, not as this file did)
  const { render } = await import("solid-js/web");
  const html = (await import("solid-js/html")).default;
  base = new Repo();
  docA = base.create({ text: "a" }).url;
  docB = base.create({ text: "b" }).url;

  // a frame: a place that can be followed, inside something that answers
  // every repo:handle-descriptor (as drafts' does)
  frame = document.createElement("div");
  const drafts = frame.appendChild(document.createElement("div"));
  drafts.addEventListener("patchwork:subscribe", (event) => {
    if (event.detail?.selector?.type === "repo:handle-descriptor") {
      providers.accept(event, (respond) => respond({ url: event.detail.selector.url }));
    }
  });
  area = drafts.appendChild(document.createElement("div"));
  area.setAttribute("data-call-follow", "main");
  document.body.append(frame);
  const areas = followAreas(frame);
  stopAreas = areas.stop;
  // what follows along as whoever you follow changes, and draws the line
  unrender = render(() => html`<${areas.Outlines} />`, frame.appendChild(document.createElement("div")));

  room = (await import("@automerge/automerge-repo/slim")).generateAutomergeUrl();
  await engine.join(room);
});

afterEach(() => {
  unrender?.();
  stopAreas?.();
  frame.remove();
  engine.hangUp();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** a view of `url` in the place, mounted */
function mount(url, toolId = "file", into = area) {
  const view = document.createElement("patchwork-view");
  view.setAttribute("doc-url", url);
  into.append(view);
  view.dispatchEvent(new CustomEvent("patchwork:mounted", { bubbles: true, composed: true, detail: { url, toolId } }));
  return view;
}

/** what a tool in `view` does: asks for its view state, and finds it with its repo */
async function viewStateIn(view) {
  let url = null;
  providers.subscribe(view, { type: "patchwork:view-state" }, (value) => (url = value));
  await settle();
  if (!url) return null;
  const repo = new providers.OverlayRepo(base, view);
  const handle = await repo.find(url);
  return { url, handle };
}

const latest = () => follow.followNews().views.main ?? null;
const heard = (from, views) =>
  handles.get(room).emit({ [KEY]: "here", from, who: { name: from }, views, following: null });

describe("a place that can be followed", () => {
  test("what's open in it is yours to share, view state and all", async () => {
    const view = mount(docA);
    expect(latest()).toEqual({ url: docA, toolId: "file", state: {} });
    const { handle } = await viewStateIn(view);
    handle.change((doc) => (doc.top = 12));
    await settle();
    expect(latest()).toEqual({ url: docA, toolId: "file", state: { top: 12 } });
  });

  test("a view in a view in it isn't the place's", async () => {
    const view = mount(docA);
    const inner = mount(docB, "file", view);
    expect(latest().url).toBe(docA);
    expect(await viewStateIn(inner)).toBe(null);
  });

  test("somewhere that isn't marked shares nothing and follows nothing", async () => {
    const elsewhere = frame.appendChild(document.createElement("div"));
    mount(docA, "file", elsewhere);
    expect(latest()).toBe(null);
  });

  test("following someone, what they've open opens here", async () => {
    mount(docA);
    const opened = vi.fn();
    frame.addEventListener("patchwork:open-document", (event) => opened(event.detail));
    heard("x", { main: { url: docB, toolId: "tldraw", state: {} } });
    follow.follow("x");
    await settle();
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ url: docB, toolId: "tldraw" }));
  });

  test("their view state shows in the tool, under the same url, and yours is where theirs got to when you stop", async () => {
    const view = mount(docA);
    const { handle } = await viewStateIn(view);
    handle.change((doc) => (doc.top = 1));
    await settle();

    heard("x", { main: { url: docA, toolId: "file", state: { top: 40 } } });
    follow.follow("x");
    await settle();
    expect(handle.doc()).toEqual({ top: 40 });

    heard("x", { main: { url: docA, toolId: "file", state: { top: 41 } } });
    await settle();
    expect(handle.doc()).toEqual({ top: 41 });

    follow.follow(null);
    await settle();
    expect(handle.doc()).toEqual({ top: 41 });
    expect(latest().state).toEqual({ top: 41 });
  });

  test("opening something else there yourself, you stop following", async () => {
    mount(docA);
    heard("x", { main: { url: docA, toolId: "file", state: {} } });
    follow.follow("x");
    await settle();
    area.replaceChildren();
    mount(docB);
    expect(follow.following()).toBe(null);
  });

  test("while you follow, a line goes round the place, with who it is: pressed, you stop", async () => {
    mount(docA);
    // (happy-dom's boxes have no size)
    area.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 200 });
    heard("x", { main: { url: docA, toolId: "file", state: {} } });
    expect(frame.querySelector(".patchwork-call-following")).toBe(null);
    follow.follow("x");
    await settle();
    const line = frame.querySelector(".patchwork-call-following");
    expect(line.style.left).toBe("10px");
    expect(line.style.width).toBe("300px");
    const tag = line.querySelector(".patchwork-call-following-tag");
    expect(tag.textContent).toContain("following");
    tag.click();
    expect(follow.following()).toBe(null);
    expect(frame.querySelector(".patchwork-call-following")).toBe(null);
  });
});
