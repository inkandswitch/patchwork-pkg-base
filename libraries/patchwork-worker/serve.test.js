import {describe, it, expect, vi} from "vitest"
import {serveWorkerSpec} from "./serve.js"

/**
 * A fake Worker: records posted messages, lets the test push replies back, and
 * tracks termination. No real Worker (happy-dom has none) — we are testing the
 * transport, so the worker is a stub.
 */
function fakeWorker() {
	const w = {
		posted: [],
		terminated: false,
		/** @type {((ev:{data:any})=>void)|null} */
		onmessage: null,
		postMessage(msg, transfer) {
			w.posted.push({msg, transfer})
		},
		terminate() {
			w.terminated = true
		},
		/** push a message from the "worker" back to the transport */
		reply(data) {
			w.onmessage?.({data})
		},
	}
	return w
}

/** Drive a served connection: write frames to writable, read frames off readable. */
function drive(streams) {
	const writer = streams.writable.getWriter()
	const reader = streams.readable.getReader()
	const frames = []
	;(async () => {
		try {
			for (;;) {
				const {value, done} = await reader.read()
				if (done) break
				frames.push(value)
			}
		} catch {}
	})()
	return {
		write: (f) => writer.write(f),
		close: () => writer.close(),
		cancelRead: () => reader.cancel(),
		frames,
		settle: async () => {
			for (let i = 0; i < 20; i++) await Promise.resolve()
			await new Promise((r) => setTimeout(r, 0))
		},
	}
}

describe("serveWorkerSpec", () => {
	it("routes a request to the worker and its reply back, re-tagged with the caller id", async () => {
		const w = fakeWorker()
		const spec = {
			createWorker: () => w,
			handle(frame, io) {
				io.on((msg) => {
					if (msg.type === "result") {
						io.emit({type: "result", text: msg.text})
						return true
					}
				})
				io.post({type: "generate", id: io.workerId, text: frame.text})
			},
		}
		const conn = drive(serveWorkerSpec(spec, {}))
		await conn.write({id: "a", op: "generate", text: "hi"})
		await conn.settle()

		// The worker saw the request…
		expect(w.posted).toHaveLength(1)
		const workerId = w.posted[0].msg.id
		expect(w.posted[0].msg.text).toBe("hi")

		// …and its reply comes back tagged with the CALLER id, not the worker id.
		w.reply({id: workerId, type: "result", text: "done"})
		await conn.settle()
		expect(conn.frames).toContainEqual({id: "a", type: "result", text: "done"})
	})

	it("gives each connection its own worker", async () => {
		const workers = []
		const spec = {
			createWorker: () => {
				const w = fakeWorker()
				workers.push(w)
				return w
			},
			handle: (frame, io) => io.post({type: "x", id: io.workerId}),
		}
		const a = drive(serveWorkerSpec(spec, {}))
		const b = drive(serveWorkerSpec(spec, {}))
		await a.write({id: "1", op: "go"})
		await b.write({id: "2", op: "go"})
		await a.settle()
		expect(workers).toHaveLength(2)
		expect(workers[0]).not.toBe(workers[1])
	})

	it("terminates the worker when the writable closes", async () => {
		const w = fakeWorker()
		const spec = {createWorker: () => w, handle: (f, io) => io.post({id: io.workerId})}
		const conn = drive(serveWorkerSpec(spec, {}))
		await conn.write({id: "a", op: "go"})
		await conn.settle()
		expect(w.terminated).toBe(false)
		await conn.close()
		await conn.settle()
		expect(w.terminated).toBe(true)
	})

	it("terminates the worker when the readable is cancelled", async () => {
		const w = fakeWorker()
		const spec = {createWorker: () => w, handle: (f, io) => io.post({id: io.workerId})}
		const conn = drive(serveWorkerSpec(spec, {}))
		await conn.write({id: "a", op: "go"})
		await conn.settle()
		await conn.cancelRead()
		await conn.settle()
		expect(w.terminated).toBe(true)
	})

	it("routes op:abort to spec.abort with the stored token", async () => {
		const w = fakeWorker()
		const aborted = []
		const spec = {
			createWorker: () => w,
			handle(frame, io) {
				io.on(() => false) // never terminal on its own
				io.post({type: "generate", id: io.workerId})
				return {sessionKey: frame.id} // the abort token
			},
			abort(token, post) {
				aborted.push(token)
				post({type: "abort", sessionKey: token.sessionKey})
			},
		}
		const conn = drive(serveWorkerSpec(spec, {}))
		await conn.write({id: "a", op: "generate"})
		await conn.settle()
		await conn.write({id: "a", op: "abort"})
		await conn.settle()

		expect(aborted).toEqual([{sessionKey: "a"}])
		// spec.abort posted the worker-specific abort payload
		expect(w.posted.some((p) => p.msg.type === "abort" && p.msg.sessionKey === "a")).toBe(true)
	})

	it("honours an abort that races in while the request is still resolving (H1)", async () => {
		// The abort arrives while `handle` is suspended on a slow `open`, i.e. before
		// the abort token has been stored. The old design read `tokens.get(id)` →
		// undefined and dropped the abort silently. It must now be deferred and fire
		// once the token lands.
		const w = fakeWorker()
		const aborted = []
		let releaseOpen
		const spec = {
			createWorker: () => w,
			open: () => new Promise((r) => (releaseOpen = r)), // gate handle until we say
			handle(frame, io) {
				io.on(() => false)
				io.post({type: "generate", id: io.workerId})
				return {sessionKey: frame.id}
			},
			abort(token) {
				aborted.push(token)
			},
		}
		const conn = drive(serveWorkerSpec(spec, {}))
		await conn.write({id: "a", op: "generate"}) // suspends inside handleFrame on open
		await conn.write({id: "a", op: "abort"}) // races in BEFORE the token exists
		await conn.settle()
		expect(aborted).toEqual([]) // deferred: nothing to abort yet

		releaseOpen(null) // let handle finish and store the token
		await conn.settle()
		expect(aborted).toEqual([{sessionKey: "a"}]) // fired once the token landed
		// …and the request is forgotten, so a duplicate abort is a no-op.
		await conn.write({id: "a", op: "abort"})
		await conn.settle()
		expect(aborted).toEqual([{sessionKey: "a"}])
	})

	it("closes the readable when the writable closes, so a reader sees end-of-stream (H2)", async () => {
		const w = fakeWorker()
		const spec = {createWorker: () => w, handle: (f, io) => io.post({id: io.workerId})}
		const streams = serveWorkerSpec(spec, {})
		const reader = streams.readable.getReader()
		const writer = streams.writable.getWriter()
		await writer.write({id: "a", op: "go"})
		// A reader blocked on read() must be released by teardown, not hang forever.
		const pending = reader.read()
		await writer.close()
		const {done} = await pending
		expect(done).toBe(true)
	})

	it("emits id-less worker messages straight onto the readable", async () => {
		const w = fakeWorker()
		const spec = {createWorker: () => w, handle: (f, io) => io.post({id: io.workerId})}
		const conn = drive(serveWorkerSpec(spec, {}))
		await conn.write({id: "a", op: "go"})
		await conn.settle()
		w.reply({type: "status", message: "downloading model"}) // no id
		await conn.settle()
		expect(conn.frames).toContainEqual({type: "status", message: "downloading model"})
	})

	it("does not duplicate a status frame per in-flight request", async () => {
		// The old design fanned an id-less status to every in-flight id, so N
		// requests saw the same text N times. One worker per connection emits it once.
		const w = fakeWorker()
		const spec = {
			createWorker: () => w,
			handle: (f, io) => {
				io.on(() => false)
				io.post({id: io.workerId})
			},
		}
		const conn = drive(serveWorkerSpec(spec, {}))
		await conn.write({id: "a", op: "go"})
		await conn.write({id: "b", op: "go"})
		await conn.settle()
		w.reply({type: "status", message: "one"})
		await conn.settle()
		const statuses = conn.frames.filter((f) => f.type === "status")
		expect(statuses).toEqual([{type: "status", message: "one"}])
	})

	it("emits {type:error} tagged with the caller id when handle throws", async () => {
		const w = fakeWorker()
		const spec = {
			createWorker: () => w,
			handle() {
				throw new Error("boom")
			},
		}
		const conn = drive(serveWorkerSpec(spec, {}))
		await conn.write({id: "a", op: "go"})
		await conn.settle()
		expect(conn.frames).toContainEqual({id: "a", type: "error", message: "boom"})
	})

	it("falls through when open never settles rather than wedging frames", async () => {
		const w = fakeWorker()
		vi.useFakeTimers()
		const spec = {
			createWorker: () => w,
			open: () => new Promise(() => {}), // never resolves
			handle: (frame, io) => {
				io.emit({type: "ran", state: io.state})
			},
		}
		const conn = drive(serveWorkerSpec(spec, {}))
		await conn.write({id: "a", op: "go"})
		// Advance past the OPEN_TIMEOUT so the bounded race resolves null.
		await vi.advanceTimersByTimeAsync(5001)
		vi.useRealTimers()
		await conn.settle()
		// handle ran anyway, with state === null (the timeout value)
		expect(conn.frames).toContainEqual({id: "a", type: "ran", state: null})
	})
})
