import {describe, it, expect, afterEach, vi} from "vitest"
import {existsSync, readFileSync} from "node:fs"
import {join} from "node:path"
import {accept} from "@inkandswitch/patchwork-providers"
import {connectWorker, rememberDiscoveryElement, openSession} from "./connect.js"

// A minimal stand-in for the worker provider: answers worker-channel
// subscriptions for the kinds it knows, and refuses the ones it doesn't. Uses
// the real `accept()`, so these tests exercise the actual providers envelope
// rather than a hand-rolled imitation of it.
function serveKinds(kinds) {
	const listener = (e) => {
		const {selector, port} = e.detail ?? {}
		if (selector?.type !== "patchwork:worker-channel" || !port) return
		const run = kinds[selector.kind]
		if (!run) return // decline, do NOT claim — let it bubble
		accept(e, (respond) => {
			Promise.resolve(run(selector.request))
				.then((streams) => {
					respond({readable: streams.readable, writable: streams.writable}, [
						streams.readable,
						streams.writable,
					])
				})
				.catch(() => respond(null))
		})
	}
	document.addEventListener("patchwork:subscribe", listener)
	return () => document.removeEventListener("patchwork:subscribe", listener)
}

/** Echoes one token + a terminal result for every request frame written. */
function echoWorker() {
	let controller
	const readable = new ReadableStream({start: (c) => (controller = c)})
	const writable = new WritableStream({
		write(frame) {
			if (frame.op === "abort") return
			controller.enqueue({id: frame.id, type: "token", delta: "hi", text: "hi"})
			controller.enqueue({id: frame.id, type: "result", text: "hi"})
		},
	})
	return {writable, readable}
}

function mountElement() {
	const el = document.createElement("div")
	document.body.appendChild(el)
	return el
}

let cleanups = []
afterEach(() => {
	cleanups.forEach((f) => f())
	cleanups = []
	rememberDiscoveryElement(null)
})

async function readN(readable, n) {
	const reader = readable.getReader()
	const out = []
	while (out.length < n) {
		const {value, done} = await reader.read()
		if (done) break
		out.push(value)
	}
	reader.releaseLock()
	return out
}

describe("connectWorker", () => {
	it("connects when a provider answers, and streams frames", async () => {
		const kind = "echo-" + Math.random()
		cleanups.push(serveKinds({[kind]: echoWorker}))
		const el = mountElement()
		cleanups.push(() => el.remove())

		const conn = await connectWorker(kind, {}, {element: el})
		expect(conn.readable).toBeInstanceOf(ReadableStream)
		expect(typeof conn.disconnect).toBe("function")

		const writer = conn.writable.getWriter()
		await writer.write({op: "generate", id: "x", text: "hi"})
		writer.releaseLock()

		const frames = await readN(conn.readable, 2)
		expect(frames[0]).toMatchObject({id: "x", type: "token"})
		expect(frames[1]).toMatchObject({id: "x", type: "result"})
	})

	it("multiplexes many request ids over one connection", async () => {
		const kind = "echo-" + Math.random()
		cleanups.push(serveKinds({[kind]: echoWorker}))
		const el = mountElement()
		cleanups.push(() => el.remove())

		const conn = await connectWorker(kind, {}, {element: el})
		const writer = conn.writable.getWriter()
		await writer.write({op: "generate", id: "a"})
		await writer.write({op: "generate", id: "b"})
		writer.releaseLock()

		const ids = (await readN(conn.readable, 4)).map((f) => f.id)
		expect(ids.filter((x) => x === "a")).toHaveLength(2)
		expect(ids.filter((x) => x === "b")).toHaveLength(2)
	})

	it("fails fast on an explicit refusal", async () => {
		// A refusal the provider already knows about must not cost the full
		// discovery timeout — this is the path the isolation host bridge uses when
		// the worker-channel selector isn't in shared-providers.
		const el = mountElement()
		cleanups.push(() => el.remove())
		const refuse = (e) => {
			const {selector, port} = e.detail ?? {}
			if (selector?.type !== "patchwork:worker-channel" || !port) return
			accept(e, (respond) => respond(null))
		}
		document.addEventListener("patchwork:subscribe", refuse)
		cleanups.push(() => document.removeEventListener("patchwork:subscribe", refuse))

		const started = Date.now()
		await expect(connectWorker("nope", {}, {element: el})).rejects.toThrow(
			/no worker available/
		)
		expect(Date.now() - started).toBeLessThan(1000)
	})

	it("rejects without an element to discover from", async () => {
		await expect(connectWorker("anything", {})).rejects.toThrow(/no element/)
	})

	it("times out when nothing answers at all", async () => {
		// Nothing is mounted, so this waits out DISCOVERY_TIMEOUT_MS. That timeout
		// is a backstop, not control flow: a mounted provider either serves or
		// refuses, and both are immediate.
		const el = mountElement()
		cleanups.push(() => el.remove())
		await expect(connectWorker("nobody-" + Math.random(), {}, {element: el})).rejects.toThrow(
			/no worker available/
		)
	}, 12000)
})

describe("openSession", () => {
	const TERMINAL = {
		result: (f) => f.text,
		error: (f) => {
			throw new Error(f.message)
		},
	}

	it("resolves on the terminal frame and streams the rest", async () => {
		const kind = "echo-" + Math.random()
		cleanups.push(serveKinds({[kind]: echoWorker}))
		const el = mountElement()
		cleanups.push(() => el.remove())

		const session = openSession(kind, {element: el})
		const seen = []
		const {promise} = session.request(
			{op: "generate"},
			{terminal: TERMINAL, onFrame: (f) => seen.push(f.type)}
		)
		await expect(promise).resolves.toBe("hi")
		expect(seen).toEqual(["token"])
	})

	it("does not cache a failed connection — a later request reconnects", async () => {
		// The regression this layer exists to prevent: one early failure used to
		// poison the module-level promise, so every later request failed instantly
		// with the stale error even once a provider was available.
		const kind = "echo-" + Math.random()
		const el = mountElement()
		cleanups.push(() => el.remove())
		const session = openSession(kind, {element: el})

		const refuse = (e) => {
			const {selector, port} = e.detail ?? {}
			if (selector?.type !== "patchwork:worker-channel" || !port) return
			accept(e, (respond) => respond(null))
		}
		document.addEventListener("patchwork:subscribe", refuse)
		const first = session.request({op: "generate"}, {terminal: TERMINAL})
		await expect(first.promise).rejects.toThrow(/no worker available/)
		document.removeEventListener("patchwork:subscribe", refuse)

		cleanups.push(serveKinds({[kind]: echoWorker}))
		const second = session.request({op: "generate"}, {terminal: TERMINAL})
		await expect(second.promise).resolves.toBe("hi")
	})

	it("fails in-flight requests when the connection drops", async () => {
		// The hang this guards: pump()'s finally used to clear the connection but
		// leave `handlers` populated, so a request awaiting a terminal frame that
		// could no longer arrive never settled — no rejection, no timeout. Chat
		// awaits generation with no deadline, so that wedged the UI silently.
		const kind = "drop-" + Math.random()
		let controller
		const listener = (e) => {
			const {selector, port} = e.detail ?? {}
			if (selector?.type !== "patchwork:worker-channel" || selector.kind !== kind) return
			accept(e, (respond) => {
				const readable = new ReadableStream({start: (c) => (controller = c)})
				const writable = new WritableStream({write() {}})
				respond({readable, writable}, [readable, writable])
			})
		}
		document.addEventListener("patchwork:subscribe", listener)
		cleanups.push(() => document.removeEventListener("patchwork:subscribe", listener))

		const el = mountElement()
		cleanups.push(() => el.remove())
		const session = openSession(kind, {element: el})
		const {promise} = session.request({op: "generate"}, {terminal: TERMINAL})

		// Let the connection establish, then end the stream with no terminal frame.
		await new Promise((r) => setTimeout(r, 20))
		controller.close()

		await expect(promise).rejects.toThrow(/closed before the request completed/)
	})

	it("rejects rather than silently dropping a frame when the writer is gone", async () => {
		// `await writer?.write(frame)` used to resolve successfully having written
		// nothing if the connection ended mid-send, leaving the request unsettled.
		const kind = "gone-" + Math.random()
		let controller
		const listener = (e) => {
			const {selector, port} = e.detail ?? {}
			if (selector?.type !== "patchwork:worker-channel" || selector.kind !== kind) return
			accept(e, (respond) => {
				const readable = new ReadableStream({start: (c) => (controller = c)})
				const writable = new WritableStream({write() {}})
				respond({readable, writable}, [readable, writable])
			})
		}
		document.addEventListener("patchwork:subscribe", listener)
		cleanups.push(() => document.removeEventListener("patchwork:subscribe", listener))

		const el = mountElement()
		cleanups.push(() => el.remove())
		const session = openSession(kind, {element: el})

		// Establish, then drop the connection so the cached writer is gone.
		const first = session.request({op: "generate"}, {terminal: TERMINAL})
		await new Promise((r) => setTimeout(r, 20))
		controller.close()
		await expect(first.promise).rejects.toThrow()

		// A later request reconnects rather than writing into the dead one.
		const second = session.request({op: "generate"}, {terminal: TERMINAL})
		await new Promise((r) => setTimeout(r, 20))
		controller.close()
		await expect(second.promise).rejects.toThrow()
	})

	it("does not open a connection to abort a request that was never sent", async () => {
		// An already-aborted signal used to fire the abort path, which called send()
		// — opening a whole connection (up to the discovery timeout) purely to
		// cancel something that never started.
		const el = mountElement()
		cleanups.push(() => el.remove())
		let dispatches = 0
		const count = (e) => {
			if (e.detail?.selector?.type === "patchwork:worker-channel") dispatches++
		}
		document.addEventListener("patchwork:subscribe", count)
		cleanups.push(() => document.removeEventListener("patchwork:subscribe", count))

		const session = openSession("never-" + Math.random(), {element: el})
		const {promise} = session.request(
			{op: "generate"},
			{terminal: TERMINAL, signal: AbortSignal.abort()}
		)
		await expect(promise).rejects.toThrow(/Aborted/)
		expect(dispatches).toBe(0)
	})

	it("rejects when the signal is already aborted", async () => {
		const el = mountElement()
		cleanups.push(() => el.remove())
		const session = openSession("x", {element: el})
		const {promise} = session.request(
			{op: "generate"},
			{terminal: TERMINAL, signal: AbortSignal.abort()}
		)
		await expect(promise).rejects.toThrow(/Aborted/)
	})
})

describe("providers envelope", () => {
	it("carries the stream pair through the value, alive on arrival", async () => {
		// The premise the whole migration rests on: respond()'s transfer list goes
		// on the OUTER postMessage, so streams nested in `value` are MOVED, not
		// structured-cloned (which would throw DataCloneError).
		const kind = "envelope-" + Math.random()
		cleanups.push(serveKinds({[kind]: echoWorker}))
		const el = mountElement()
		cleanups.push(() => el.remove())

		const conn = await connectWorker(kind, {}, {element: el})
		expect(conn.readable).toBeInstanceOf(ReadableStream)
		expect(conn.writable).toBeInstanceOf(WritableStream)

		// Live, not a detached husk: a round trip still works.
		const writer = conn.writable.getWriter()
		await writer.write({id: "1", op: "generate"})
		writer.releaseLock()
		const {value} = await conn.readable.getReader().read()
		expect(value).toMatchObject({id: "1", type: "token"})
	})

	it("rejects on a null value rather than hanging", async () => {
		// A claimed subscription that answers `null` must fail fast — not wait out
		// the 8s discovery backstop.
		const el = mountElement()
		cleanups.push(() => el.remove())
		const refuse = (e) => {
			const {selector, port} = e.detail ?? {}
			if (selector?.type !== "patchwork:worker-channel" || !port) return
			accept(e, (respond) => respond(null))
		}
		document.addEventListener("patchwork:subscribe", refuse)
		cleanups.push(() => document.removeEventListener("patchwork:subscribe", refuse))

		const started = Date.now()
		await expect(connectWorker("nope", {}, {element: el})).rejects.toThrow(
			/no worker available/
		)
		expect(Date.now() - started).toBeLessThan(1000)
	})

	it("re-discovers on the next request after a refusal", async () => {
		// `null` means "asked, got nothing" — the session drops the connection so a
		// later request tries again, rather than staying dead forever.
		const TERMINAL = {
			result: (f) => f.text,
			error: (f) => {
				throw new Error(f.message)
			},
		}
		const kind = "retry-" + Math.random()
		const el = mountElement()
		cleanups.push(() => el.remove())

		const refuse = (e) => {
			const {selector, port} = e.detail ?? {}
			if (selector?.type !== "patchwork:worker-channel" || selector.kind !== kind) return
			accept(e, (respond) => respond(null))
		}
		document.addEventListener("patchwork:subscribe", refuse)

		const session = openSession(kind, {element: el})
		const first = session.request({op: "generate"}, {terminal: TERMINAL})
		await expect(first.promise).rejects.toThrow(/no worker available/)

		// The provider shows up late; the next request must find it.
		document.removeEventListener("patchwork:subscribe", refuse)
		cleanups.push(serveKinds({[kind]: echoWorker}))

		const second = session.request({op: "generate"}, {terminal: TERMINAL})
		await expect(second.promise).resolves.toBe("hi")
	})
})

describe("package shape", () => {
	// The entry-point split that caused a real outage: consumers bake a subpath
	// literal at BUILD time (resolved from `exports`), separate from the automerge
	// pin. Two entry points to one state-holding module means two module
	// instances. Here connect.js holds no registry at all — the rendezvous lives
	// in the host plugin registry — but the consumer/provider split still has to
	// stay honest.
	const dir = process.cwd()
	const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))

	it("keeps the consumer transport importable on its own", () => {
		// chat loads ONLY this file into the sandbox.
		expect(existsSync(join(dir, "connect.js"))).toBe(true)
		expect(pkg.exports["./connect.js"].default).toBe("./connect.js")
		expect(pkg.files).toContain("connect.js")
	})

	it("keeps the consumer transport free of the plugin registry", () => {
		// The host provider (providers package) pulls in the plugin registry;
		// connect.js must not, or the sandbox would drag the host registry in with
		// the transport.
		const src = readFileSync(join(dir, "connect.js"), "utf8")
		expect(src).not.toMatch(/patchwork-plugins/)
	})

	it("exposes the serve half by subpath for the host provider", () => {
		// The provider lives in another package and imports serveWorkerSpec through
		// `exports`, so this entry is load-bearing the same way ./connect.js is.
		expect(existsSync(join(dir, "serve.js"))).toBe(true)
		expect(pkg.exports["./serve.js"].default).toBe("./serve.js")
		expect(pkg.files).toContain("serve.js")
	})

	it("is a library: no plugins, no provider, no host-only imports in the entry", () => {
		// The provider moved to the providers package. Nothing here registers with
		// the module loader, and the entry stays free of @inkandswitch/patchwork-plugins
		// (whose graph reaches `window.location.origin`).
		expect(pkg.exports["./provider.js"]).toBeUndefined()
		expect(existsSync(join(dir, "provider.js"))).toBe(false)
		const src = readFileSync(join(dir, "index.js"), "utf8")
		expect(src).not.toMatch(/^\s*export\s+const\s+plugins\b/m)
		expect(src).not.toMatch(/^\s*import[^\n]*patchwork-plugins/m)
	})

	it("exposes no worker registry from the transport", () => {
		// Workers are resolved from the patchwork:worker plugin registry by the
		// provider — there is deliberately no module-level Map here to split.
		const src = readFileSync(join(dir, "connect.js"), "utf8")
		expect(src).not.toMatch(/localWorkers/)
	})
})
