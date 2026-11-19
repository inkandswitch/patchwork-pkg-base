import { test } from "vitest";
import assert from "node:assert/strict";
import {
  SPEAKING_AFTER,
  QUIET_AFTER,
  least,
  levelOf,
  qualityOf,
  CAPTURE_LEAST,
  askFor,
  captureFor,
  degradeFor,
  seenStep,
  sendFor,
  speakingStep,
  tilesFor,
  videoFor,
  videoForSeen,
} from "../src/engine/sizes.js";

test("the sidebar's tiles: big while there are few, chips when there are many", () => {
  assert.equal(tilesFor(1), "tiles");
  assert.equal(tilesFor(4), "tiles");
  assert.equal(tilesFor(5), "grid");
  assert.equal(tilesFor(9), "grid");
  assert.equal(tilesFor(10), "chips");
  assert.equal(tilesFor(20), "chips");
});

test("video sent: less of it, the more people there are to send it to", () => {
  assert.equal(videoFor(1), null);
  assert.equal(videoFor(5), null);
  const six = videoFor(6);
  const ten = videoFor(10);
  assert.ok(six.maxBitrate > ten.maxBitrate);
  assert.ok(six.scaleResolutionDownBy < ten.scaleResolutionDownBy);
  assert.ok(ten.maxFramerate <= six.maxFramerate);
});

test("quality: full is as it comes, and each step down is less", () => {
  assert.equal(qualityOf("full"), null);
  assert.equal(qualityOf("nonsense"), null);
  assert.ok(qualityOf("medium").maxBitrate > qualityOf("low").maxBitrate);
  assert.ok(qualityOf("low").maxBitrate > qualityOf("potato").maxBitrate);
});

test("the least of several encodings: each part at its least", () => {
  assert.equal(least(null, null), null);
  assert.deepEqual(least(null, qualityOf("low")), qualityOf("low"));
  assert.deepEqual(least({ maxBitrate: 300_000, scaleResolutionDownBy: 2, maxFramerate: 20 }, qualityOf("medium")), {
    maxBitrate: 300_000,
    scaleResolutionDownBy: 2,
    maxFramerate: 15,
  });
  assert.deepEqual(least({ maxFramerate: 12 }), { maxFramerate: 12 });
});

test("how much of someone's shown: not at all, how tall up to a little smaller than usual, or shown", () => {
  assert.equal(seenStep(0), 0);
  assert.equal(seenStep(undefined), 0);
  assert.equal(seenStep(26), 28);
  assert.equal(seenStep(54), 56);
  assert.equal(seenStep(120), 120);
  // as a floating face starts, and a whole screen of them: told alike
  assert.equal(seenStep(150), null);
  assert.equal(seenStep(1000), null);
  // told in device px, so it's sent sharp on that screen
  assert.equal(seenStep(26, 2), 56);
});

test("sent no bigger than it's shown, every frame still: shown is as it comes", () => {
  assert.equal(videoForSeen(null), null);
  const chip = videoForSeen(80, 720);
  assert.equal(chip.scaleResolutionDownBy, 9);
  assert.equal(chip.maxFramerate, undefined);
  assert.equal(videoForSeen(240, 720).scaleResolutionDownBy, 3);
  assert.equal(videoForSeen(240, 720).maxFramerate, undefined);
});

test("what's asked of someone: theirs in full alt clicked, everyone else's less", () => {
  assert.deepEqual(askFor({ receive: "full", seen: null }), { wants: "full", seen: null });
  assert.deepEqual(askFor({ receive: "potato", seen: 120 }), { wants: "potato", seen: 120 });
  // alt clicked: full, whatever size, while you're looking
  assert.deepEqual(askFor({ receive: "low", sharpened: true, anySharp: true, seen: 120 }), { wants: "full", seen: null });
  assert.deepEqual(askFor({ sharpened: true, anySharp: true, seen: 0 }), { wants: "full", seen: 0 });
  // someone else's in full: yours less
  assert.deepEqual(askFor({ receive: "full", anySharp: true }), { wants: "low", seen: null });
  assert.deepEqual(askFor({ receive: "medium", anySharp: true }), { wants: "medium", seen: null });
});

test("not looked at: a frame a second, not nothing", () => {
  const unseen = videoForSeen(0, 720);
  assert.equal(unseen.maxFramerate, 1);
  assert.equal(unseen.scaleResolutionDownBy, 8);
  assert.ok(unseen.maxBitrate <= 30_000);
});

test("what's sent one person: scaled from what's captured to what they need", () => {
  assert.equal(sendFor({ native: 720 }), null);
  // they show you 180 tall: a quarter of it
  assert.equal(sendFor({ native: 720, seen: 180 }).scaleResolutionDownBy, 4);
  // captured at 360 already (someone else wants that much): half of that
  assert.equal(sendFor({ native: 720, captured: 360, seen: 180 }).scaleResolutionDownBy, 2);
  // captured smaller than they'd have it: as it is
  assert.equal(sendFor({ native: 720, captured: 360, seen: null }), null);
  // what you'll send, and what they want, too
  assert.equal(sendFor({ native: 720, send: "low" }).scaleResolutionDownBy, 2);
  assert.equal(sendFor({ native: 720, wants: "potato" }).maxFramerate, 5);
});

test("what's captured: as much as the one who wants most, no more than you'll send", () => {
  const native = { height: 720, frameRate: 30 };
  assert.equal(captureFor({ native }), null);
  // everyone has you small: captured small, but never too small
  assert.equal(captureFor({ native, peers: [{ seen: 56 }, { seen: 240 }] }).height, 240);
  assert.equal(captureFor({ native, peers: [{ seen: 56 }] }).height, CAPTURE_LEAST);
  // nobody's looking
  assert.equal(captureFor({ native, peers: [{ seen: 0 }, { seen: 0 }] }).height, CAPTURE_LEAST);
  // anyone showing you at all: all of it
  assert.equal(captureFor({ native, peers: [{ seen: 56 }, { seen: null }] }), null);
  // unless you'll send less, or they want less
  assert.deepEqual(captureFor({ native, send: "low", peers: [{ seen: null }] }), { height: 360, frameRate: 10 });
  assert.equal(captureFor({ native, peers: [{ wants: "low" }] }).height, 360);
  // the computer struggling
  assert.equal(captureFor({ native, strain: 1 }).height, 480);
});

test("what gives: moving keeps frames, sharp keeps the picture", () => {
  assert.equal(degradeFor("motion"), "maintain-framerate");
  assert.equal(degradeFor("text"), "maintain-resolution");
  assert.equal(degradeFor(""), "balanced");
});

test("a level: silence is nothing, a full swing is loud", () => {
  assert.equal(levelOf(new Uint8Array(64).fill(128)), 0);
  const swing = Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 255 : 0));
  assert.ok(levelOf(swing) > 0.9);
});

test("speaking: a moment's sound isn't, and a pause doesn't stop it", () => {
  let state = { speaking: false, loudSince: null, quietSince: null };
  // a click
  state = speakingStep(state, 0.3, 0);
  state = speakingStep(state, 0.0, 50);
  assert.equal(state.speaking, false);
  // talking
  state = speakingStep(state, 0.3, 1000);
  state = speakingStep(state, 0.3, 1000 + SPEAKING_AFTER);
  assert.equal(state.speaking, true);
  // a breath
  state = speakingStep(state, 0.0, 2000);
  state = speakingStep(state, 0.0, 2000 + QUIET_AFTER - 1);
  assert.equal(state.speaking, true);
  // stopped
  state = speakingStep(state, 0.0, 2000 + QUIET_AFTER);
  assert.equal(state.speaking, false);
});
