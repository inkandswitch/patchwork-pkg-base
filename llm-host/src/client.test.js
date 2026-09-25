import {describe, it, expect, vi} from "vitest"
import {makeLLMClient} from "./client.js"

/**
 * A fake transport session: records the request frame + opts and lets the test
 * drive the terminal/onFrame callbacks the way session.js would.
 */
function fakeSession() {
	/** @type {any} */
	const seen = {frame: null, opts: null}
	let settle = /** @type {any} */ (null)
	const session = {
		request(frame, opts) {
			seen.frame = frame
			seen.opts = opts
			const promise = new Promise((resolve, reject) => {
				settle = {resolve, reject}
			})
			return {promise, abort: vi.fn()}
		},
	}
	/** Deliver a terminal frame through opts.terminal, like session.js does. */
	const terminal = (f) => {
		try {
			settle.resolve(seen.opts.terminal[f.type](f))
		} catch (e) {
			settle.reject(e)
		}
	}
	const frame = (f) => seen.opts.onFrame(f)
	return {session, seen, terminal, frame}
}

describe("makeLLMClient", () => {
	it("returns the client API: {generate} only", () => {
		const {session} = fakeSession()
		const client = makeLLMClient(session)
		expect(Object.keys(client)).toEqual(["generate"])
		expect(typeof client.generate).toBe("function")
	})

	it("sends a generate frame with messages, scope, system, tools and sessionKey", async () => {
		const {session, seen, terminal} = fakeSession()
		const client = makeLLMClient(session)
		const el = {}
		const signal = new AbortController().signal
		const p = client.generate([{role: "user", content: "hi"}], {
			sessionKey: "doc-1",
			scope: {toolId: "chat"},
			system: {default: "be brief"},
			tools: [{name: "x"}],
			element: /** @type {any} */ (el),
			signal,
		})
		expect(seen.frame).toEqual({
			op: "generate",
			sessionKey: "doc-1",
			scope: {toolId: "chat"},
			system: {default: "be brief"},
			tools: [{name: "x"}],
			messages: [{role: "user", content: "hi"}],
		})
		expect(seen.opts.element).toBe(el)
		expect(seen.opts.signal).toBe(signal)
		terminal({type: "result", text: "hello", toolCalls: null})
		await expect(p).resolves.toEqual({text: "hello", toolCalls: null, toolMode: undefined})
	})

	it("sends a string prompt as text", async () => {
		const {session, seen, terminal} = fakeSession()
		const p = makeLLMClient(session).generate("continue this")
		expect(seen.frame.text).toBe("continue this")
		expect(seen.frame.messages).toBeUndefined()
		terminal({type: "result", text: "…"})
		await p
	})

	it("passes structured toolCalls and toolMode through from the result frame", async () => {
		const {session, terminal} = fakeSession()
		const p = makeLLMClient(session).generate("x")
		terminal({type: "result", text: "t", toolCalls: [{name: "x", args: {}}], toolMode: "template"})
		await expect(p).resolves.toEqual({
			text: "t",
			toolCalls: [{name: "x", args: {}}],
			toolMode: "template",
		})
	})

	it("rejects with the error frame's message", async () => {
		const {session, terminal} = fakeSession()
		const p = makeLLMClient(session).generate("x")
		terminal({type: "error", message: "boom"})
		await expect(p).rejects.toThrow("boom")
	})

	it("routes token / status / model frames to the callbacks", async () => {
		const {session, frame, terminal} = fakeSession()
		const onToken = vi.fn()
		const onStatus = vi.fn()
		const onModel = vi.fn()
		const p = makeLLMClient(session).generate("x", {onToken, onStatus, onModel})
		frame({type: "token", delta: "h", text: "h"})
		frame({type: "status", message: "loading"})
		frame({type: "model", label: "Local 1B"})
		frame({type: "stats", tokPerSec: 1}) // ignored
		expect(onToken).toHaveBeenCalledWith("h", "h")
		expect(onStatus).toHaveBeenCalledWith("loading")
		expect(onModel).toHaveBeenCalledWith("Local 1B")
		terminal({type: "result", text: "h"})
		await p
	})
})
