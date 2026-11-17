import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { generateAutomergeUrl } from "@automerge/automerge-repo/slim";
import { freshPage, settle } from "./fake.js";

let engine, CallVideo, element, stop;
beforeEach(async () => {
  freshPage();
  engine = await import("../src/engine/call.js");
  ({ CallVideo } = await import("../src/video.js"));
  element = document.body.appendChild(document.createElement("div"));
  stop = CallVideo(element);
});
afterEach(() => {
  stop();
  element.remove();
  engine.hangUp();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("out of a call, it says so", () => {
  expect(element.querySelector(".patchwork-call-video-none")?.textContent).toBe("no call");
  expect(element.querySelector(".patchwork-call-tiles")).toBe(null);
});

test("in one, everyone's tiles: you, to start with", async () => {
  await engine.join(generateAutomergeUrl());
  await settle();
  expect(element.querySelector(".patchwork-call-video-none")).toBe(null);
  expect(element.querySelector('.patchwork-call-tiles .patchwork-call-tile[data-mine]')).not.toBe(null);
});
