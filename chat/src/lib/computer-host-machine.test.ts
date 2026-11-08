import {describe, it, expect} from "vitest"
import {
	step,
	effectsOf,
	STALE_AFTER,
	type HostState,
	type HostEvent,
	type DocView,
} from "./computer-host-machine"

const doc = (o: Partial<DocView> = {}): DocView => ({
	hasComputer: true,
	hostId: "other",
	heartbeat: 100,
	me: "me",
	now: 1000,
	...o,
})
const mounted = (o: Partial<DocView> = {}, epoch = 1): HostEvent => ({
	type: "mounted",
	epoch,
	...doc(o),
})
const tick = (o: Partial<DocView> = {}, epoch = 2): HostEvent => ({
	type: "tick",
	epoch,
	...doc(o),
})

const none: HostState = {kind: "none"}
const watching: HostState = {kind: "watching", seenBeat: 100, seenAt: 1000}
const pinging: HostState = {kind: "pinging", epoch: 1}
const claiming: HostState = {kind: "claiming", epoch: 1}
const hosting: HostState = {kind: "hosting"}
const stopped: HostState = {kind: "stopped"}

describe("none", () => {
	it("stays none when the chat has no computer", () => {
		expect(step(none, mounted({hasComputer: false}))).toBe(none)
	})
	it("a listed host with a fresh-looking heartbeat is pinged, not claimed", () => {
		expect(step(none, mounted({heartbeat: 999}))).toEqual(pinging)
	})
	it("no host listed: claim", () => {
		expect(step(none, mounted({hostId: null}))).toEqual(claiming)
	})
	it("a stale-looking heartbeat is still pinged (we have no local clock for it)", () => {
		expect(step(none, mounted({heartbeat: 1}))).toEqual(pinging)
	})
	it("take claims", () => {
		expect(step(none, {type: "take", epoch: 5})).toEqual({kind: "claiming", epoch: 5})
	})
	it("ignores ticks while the chat has no computer, and pongs and timeouts", () => {
		expect(step(none, tick({hasComputer: false}))).toBe(none)
		expect(step(none, {type: "pong", heartbeat: 1, now: 1})).toBe(none)
		expect(step(none, {type: "ping-timeout", epoch: 1})).toBe(none)
	})
	it("a computer invited by another tab after we mounted: start watching it", () => {
		expect(step(none, tick({heartbeat: 7, now: 50}))).toEqual({
			kind: "watching",
			seenBeat: 7,
			seenAt: 50,
		})
	})
	it("...and then go silent: the watcher can ping and take over", () => {
		const w = step(none, tick({heartbeat: 7, now: 50}))
		expect(step(w, {type: "host-silent", epoch: 3})).toEqual({kind: "pinging", epoch: 3})
		expect(step(w, tick({heartbeat: 7, now: 50 + STALE_AFTER + 1}, 4))).toEqual({
			kind: "claiming",
			epoch: 4,
		})
	})
	it("a computer with nobody holding it: claim", () => {
		expect(step(none, tick({hostId: null}, 6))).toEqual({kind: "claiming", epoch: 6})
	})
})

describe("pinging", () => {
	it("pong -> watching, recording what we saw and when", () => {
		expect(step(pinging, {type: "pong", heartbeat: 7, now: 50})).toEqual({
			kind: "watching",
			seenBeat: 7,
			seenAt: 50,
		})
	})
	it("ping timeout -> claiming", () => {
		expect(step(pinging, {type: "ping-timeout", epoch: 1})).toEqual(claiming)
	})
	it("a stale ping timeout is ignored", () => {
		expect(step(pinging, {type: "ping-timeout", epoch: 0})).toBe(pinging)
	})
	it("a timeout from an earlier ping does not claim after a pong", () => {
		const w = step(pinging, {type: "pong", heartbeat: 7, now: 50})
		expect(step(w, {type: "ping-timeout", epoch: 1})).toBe(w)
	})
	it("ticks don't move it", () => {
		expect(step(pinging, tick({now: 1e9}))).toBe(pinging)
	})
	it("a kick mid-ping -> none, and the late timeout can't claim it back", () => {
		const n = step(pinging, tick({hasComputer: false}))
		expect(n).toEqual(none)
		expect(step(n, {type: "ping-timeout", epoch: 1})).toBe(n)
	})
	it("a kick mid-claim -> none, and the late claimed is ignored", () => {
		const n = step(claiming, tick({hasComputer: false}))
		expect(n).toEqual(none)
		expect(step(n, {type: "claimed", epoch: 1})).toBe(n)
	})
})

describe("watching", () => {
	it("an unchanged heartbeat within the threshold stays", () => {
		expect(step(watching, tick({now: 1000 + STALE_AFTER}))).toBe(watching)
	})
	it("a changed heartbeat refreshes seenAt with local time", () => {
		expect(step(watching, tick({heartbeat: 101, now: 5000}))).toEqual({
			kind: "watching",
			seenBeat: 101,
			seenAt: 5000,
		})
	})
	it("clock skew is irrelevant: a huge-looking heartbeat that keeps changing is alive", () => {
		let s: HostState = watching
		for (let i = 1; i <= 5; i++) {
			s = step(s, tick({heartbeat: 9e12 + i, now: 1000 + i * 15000}))
			expect(s.kind).toBe("watching")
		}
	})
	it("unchanged beyond the threshold -> claiming", () => {
		expect(step(watching, tick({now: 1000 + STALE_AFTER + 1}))).toEqual({
			kind: "claiming",
			epoch: 2,
		})
	})
	it("host released the claim -> claiming", () => {
		expect(step(watching, tick({hostId: null}))).toEqual({kind: "claiming", epoch: 2})
	})
	it("computer kicked in the doc -> none", () => {
		expect(step(watching, tick({hasComputer: false}))).toEqual(none)
	})
	it("unanswered message -> pinging", () => {
		expect(step(watching, {type: "host-silent", epoch: 3})).toEqual({
			kind: "pinging",
			epoch: 3,
		})
	})
	it("a pong while watching is ignored", () => {
		expect(step(watching, {type: "pong", heartbeat: 1, now: 1})).toBe(watching)
	})
})

describe("claiming", () => {
	it("claimed -> hosting", () => {
		expect(step(claiming, {type: "claimed", epoch: 1})).toEqual(hosting)
	})
	it("a stale claimed result is ignored", () => {
		expect(step(claiming, {type: "claimed", epoch: 0})).toBe(claiming)
	})
	it("a claim failure falls back to watching", () => {
		expect(step(claiming, {type: "claim-failed", epoch: 1, now: 9})).toEqual({
			kind: "watching",
			seenBeat: null,
			seenAt: 9,
		})
	})
	it("a stale claim failure is ignored", () => {
		expect(step(claiming, {type: "claim-failed", epoch: 0, now: 9})).toBe(claiming)
	})
	it("our own claim showing up in a tick doesn't disturb it", () => {
		expect(step(claiming, tick({hostId: "me"}))).toBe(claiming)
	})
})

describe("hosting", () => {
	it("own heartbeat ticks leave it alone", () => {
		expect(step(hosting, tick({hostId: "me"}))).toBe(hosting)
	})
	it("ousted by another tab -> watching, not silent", () => {
		expect(step(hosting, tick({hostId: "other", heartbeat: 55, now: 77}))).toEqual({
			kind: "watching",
			seenBeat: 55,
			seenAt: 77,
		})
	})
	it("kicked in the doc -> none", () => {
		expect(step(hosting, tick({hasComputer: false}))).toEqual(none)
	})
	it("take while hosting changes nothing (driver rewrites the claim)", () => {
		expect(step(hosting, {type: "take", epoch: 4})).toBe(hosting)
	})
	it("stale results are ignored", () => {
		expect(step(hosting, {type: "claimed", epoch: 1})).toBe(hosting)
		expect(step(hosting, {type: "ping-timeout", epoch: 1})).toBe(hosting)
		expect(step(hosting, {type: "pong", heartbeat: 1, now: 1})).toBe(hosting)
	})
})

describe("kick and unmount", () => {
	it("kicked from any live state -> none", () => {
		for (const s of [watching, pinging, claiming, hosting])
			expect(step(s, {type: "kicked"})).toEqual(none)
		expect(step(none, {type: "kicked"})).toBe(none)
	})
	it("unmount from any state -> stopped", () => {
		for (const s of [none, watching, pinging, claiming, hosting])
			expect(step(s, {type: "unmount"})).toEqual(stopped)
	})
	it("stopped ignores everything, even a late claimed", () => {
		for (const e of [
			mounted(),
			tick(),
			{type: "claimed", epoch: 1},
			{type: "take", epoch: 1},
			{type: "pong", heartbeat: 1, now: 1},
			{type: "unmount"},
		] as HostEvent[])
			expect(step(stopped, e)).toBe(stopped)
	})
})

describe("effectsOf", () => {
	it("unmount while hosting releases, aborts the response, stops the listener and timer", () => {
		const fx = effectsOf(hosting, stopped)
		expect(fx).toEqual(
			expect.arrayContaining([
				"release",
				"abort-response",
				"stop-listener",
				"stop-heartbeat",
			])
		)
	})
	it("unmount while watching stops the timer but doesn't release", () => {
		const fx = effectsOf(watching, stopped)
		expect(fx).toContain("stop-heartbeat")
		expect(fx).not.toContain("release")
	})
	it("entering pinging pings; entering claiming claims", () => {
		expect(effectsOf(none, pinging)).toContain("ping")
		expect(effectsOf(pinging, claiming)).toContain("claim")
	})
	it("a pong starts the staleness watch", () => {
		expect(effectsOf(pinging, watching)).toContain("start-heartbeat")
	})
	it("becoming host starts the listener and heartbeat", () => {
		expect(effectsOf(claiming, hosting)).toEqual(
			expect.arrayContaining(["start-listener", "start-heartbeat"])
		)
	})
	it("ousted host stops answering and starts watching, with no release", () => {
		const fx = effectsOf(hosting, watching)
		expect(fx).toEqual(expect.arrayContaining(["abort-response", "stop-listener"]))
		expect(fx).not.toContain("release")
		expect(fx).not.toContain("stop-heartbeat")
	})
	it("no change, no effects", () => {
		expect(effectsOf(watching, watching)).toEqual([])
	})
})
