/**
 * connectWorker — a generic, transferable-stream connection to a worker-backed
 * service.
 *
 * A tool asks to connect to a worker doing some kind of work and, for the
 * lifetime of that connection, holds a `WritableStream` (to send request frames)
 * and a `ReadableStream` (to receive event frames). The worker itself, and any
 * privileged setup it needs (config/secrets), live on whichever side answers the
 * connection — the SAME realm when there's no isolation boundary, or the host
 * realm when the consumer runs inside a sandboxed iframe. Either way the consumer
 * sees an identical `{readable, writable}` pair; the streams are transferable, so
 * they cross the isolation boundary unchanged.
 *
 * This file is the CONSUMER half. `connectWorker(kind, request, opts?)` returns
 * `{readable, writable, disconnect}`; a provider answers via the discovery event
 * (in-realm, or — across isolation — a bridge that produces host-realm streams).
 * If nothing answers, it rejects. There is no local fallback.
 *
 * The SERVING half is `serveWorkerSpec` (./serve.js), driven by the host-realm
 * `patchwork-worker-provider` component (shipped by the `providers` package),
 * which resolves a WorkerSpec for the requested `kind` from the
 * `patchwork:worker` plugin registry. Consumers never import serve.js — chat
 * loads only this file into the sandbox.
 *
 * This module is service-agnostic: it knows nothing about LLMs. It only moves a
 * request out and a stream of events back, and lets something in between (a
 * middlebox) sit on the streams. The LLM is the first consumer: `@grjte/llm-host`
 * registers a `patchwork:worker` plugin with id "llm".
 *
 * Frame shapes are the service's concern; connect.js treats them as opaque
 * structured-cloneable values. For the LLM these reuse the worker's existing
 * message vocabulary (token / prediction / stats / result / error / …), tagged
 * with an `id` so many requests can multiplex over one connection.
 *
 * Discovery/handoff goes through patchwork-providers: this file calls
 * `subscribe()` and the host provider answers with `accept()`. The stream pair
 * rides in the value; `respond`'s transfer list moves rather than clones it, so
 * the streams stay live across the isolation boundary.
 */

import {createOpenSession} from "./session.js"

/**
 * The selector type used to discover a worker-connection provider. A consumer
 * dispatches a `patchwork:subscribe` for `{ type: CHANNEL_SELECTOR, kind, request }`
 * carrying a MessagePort in `detail.port`. The answering side replies over that
 * port with exactly one of:
 *
 *   {readable, writable}  — success; the pair is TRANSFERRED, not cloned
 *   null                  — refused; fail fast
 *
 * Both arrive in the standard providers envelope (`{type:"change", value}`),
 * because the answering side responds through `accept()`.
 *
 * Refusal is a `null` VALUE rather than its own message type: `accept()` owns
 * the envelope, so there is no second type to use. That is the trade for
 * speaking the canonical protocol, and it matches what every other provider in
 * the repo now answers when it cannot serve.
 *
 * Silence is also a valid outcome (nothing is mounted to answer), which the
 * consumer's bounded discovery timeout covers. Answering sides that KNOW they're
 * refusing should respond `null` rather than staying silent, so the consumer
 * doesn't wait out the timeout for an answer that already exists.
 *
 * Deliberately a STRING, not a Symbol. Comparisons against it are `===` on the
 * value (here, in the host worker provider, and as an inlined literal in the
 * isolation iframe bridge), so it keeps working even if this module is somehow
 * evaluated more than once. A Symbol would silently stop matching.
 */
export const CHANNEL_SELECTOR = "patchwork:worker-channel"

/**
 * BACKSTOP: how long to wait for a provider to answer before giving up.
 *
 * Not control flow. A mounted provider either serves the kind (streams) or
 * refuses it (`worker-unavailable`), and both are immediate — so in a healthy
 * frame this timer never fires. It exists because an unclaimed
 * `patchwork:subscribe` never settles by design (upstream removed the
 * `<fallback-provider>` that used to answer `null`, so a subscription can wait
 * for a provider that mounts later). Without a bound, a missing provider would
 * hang the caller forever instead of erroring.
 *
 * If you find yourself tuning this number, something upstream is wrong: the
 * frame should be gating its subtree on the provider being mounted.
 */
const DISCOVERY_TIMEOUT_MS = 8000

/** @typedef {{ readable: ReadableStream, writable: WritableStream }} WorkerStreams */
/** @typedef {WorkerStreams & { disconnect: () => void }} WorkerConnection */
/**
 * What a `patchwork:worker` plugin's `load()` must resolve to: a WorkerSpec that
 * `serveWorkerSpec` (serve.js) drives. The transport owns the streams, ids, and
 * per-connection worker; the spec owns only its op vocabulary. `open(ctx)` gets
 * the provider's mount point, so a worker can resolve host-realm context (a
 * settings doc, say) without the provider knowing about that service.
 *
 * (Shape mirrored from serve.js's `WorkerSpec`; kept as a local typedef rather
 * than importing serve.js, because this file is the sandbox-loaded consumer half
 * and must not pull the host-only serve module into its graph. Types erase, so
 * this costs nothing at runtime.)
 * @typedef {{
 *   createWorker: () => Worker | Promise<Worker>,
 *   open?: (ctx: {element?: HTMLElement}) => any,
 *   handle: (frame: any, io: any) => any,
 *   abort?: (token: any, post: (msg: any, transfer?: Transferable[]) => void) => void,
 * }} WorkerSpec
 */

/**
 * The descriptor a package puts in its `plugins` array to offer a worker.
 * @typedef {{type: "patchwork:worker", id: string, name?: string, load: () => Promise<WorkerSpec>}} WorkerPlugin
 */

/**
 * Open a connection to a worker of `kind`.
 *
 * A `patchwork:subscribe` provider for `{type: CHANNEL_SELECTOR, kind}` in the
 * DOM subtree of `opts.element` answers, transferring streams back over the
 * port. In the host realm that's a mounted worker provider; inside isolation
 * it's the providers-bridge, which relays to the host and transfers the host's
 * streams across the boundary. Either way the consumer gets the same
 * `{readable, writable, disconnect}` and never learns which answered.
 *
 * There is deliberately NO fallback to a locally-registered worker. Inside the
 * sandbox that fallback was a hole: any in-boundary tool that imported a service
 * package would register its worker as an import side-effect, and a connection
 * that should have been refused would instead run the worker in the opaque
 * origin — no shared model cache, no host config, and no signal that the
 * isolation boundary had been bypassed. Serving is the provider's job; a
 * consumer with no provider ancestor fails loudly instead.
 *
 * @param {string} kind
 * @param {any} request  the opening request (service-specific; carried to `run`)
 * @param {{ element?: HTMLElement | null, signal?: AbortSignal }} [opts]
 * @returns {Promise<WorkerConnection>}
 */
export async function connectWorker(kind, request, opts = {}) {
	const el = opts.element ?? discoveryElement()
	if (!el) {
		throw new Error(
			`no worker available for kind "${kind}": no element to discover a provider from`
		)
	}
	const streams = await discoverViaProvider(el, kind, request)
	if (!streams) {
		throw new Error(`no worker available for kind "${kind}"`)
	}
	return withDisconnect(streams)
}

/** Wrap a {readable, writable} with a disconnect() that tears both ends down. */
function withDisconnect(streams) {
	return {
		...streams,
		disconnect() {
			try {
				streams.readable.cancel?.()
			} catch {}
			try {
				streams.writable.abort?.()
			} catch {}
		},
	}
}

/**
 * Ask a `patchwork:worker-channel` provider to open a connection, via providers
 * `subscribe()`. The answering side responds through `accept()` with the stream
 * pair in the value and both streams named in the transfer list, so they are
 * moved rather than cloned. Resolves null on an explicit refusal, or if nothing
 * answers within the discovery timeout.
 *
 * @param {HTMLElement} element
 * @param {string} kind
 * @param {any} request
 * @returns {Promise<WorkerStreams | null>}
 */
function discoverViaProvider(element, kind, request) {
	return new Promise((resolve) => {
		let settled = false
		/** @type {(() => void) | null} */
		let unsubscribe = null

		const finish = (/** @type {WorkerStreams | null} */ v) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			// One-shot: the provider may hold the subscription open, but we only ever
			// want the first answer.
			try {
				unsubscribe?.()
			} catch {}
			resolve(v)
		}
		const timer = setTimeout(() => finish(null), DISCOVERY_TIMEOUT_MS)

		// patchwork-providers is imported DYNAMICALLY, and that is load-bearing.
		// This file is in the entry graph (index.js -> connect.js), and the module
		// loader evaluates the entry in a WORKER to read `plugins`. Every static
		// import here becomes part of that evaluation; a bare specifier the worker
		// cannot resolve kills the whole package with "ReferenceError: window is
		// not defined". Before this migration connect.js had ONLY relative
		// imports — keep it that way.
		//
		// `subscribe` is typed `T extends JSONValue`, but a transferred stream pair
		// is not JSON — the cast is that constraint biting. `accept<T = JSONValue>`
		// is deliberately unconstrained for exactly this case; the consumer half
		// was never widened to match. Worth fixing upstream.
		void import("@inkandswitch/patchwork-providers")
			.then(({subscribe}) => {
				if (settled) return
				unsubscribe = /** @type {any} */ (subscribe)(
					element,
					{type: CHANNEL_SELECTOR, kind, request},
					(/** @type {WorkerStreams | null} */ value) => {
						// `null` is an explicit refusal — settle now rather than burning
						// the full discovery timeout for an answer that already exists.
						if (value && value.readable && value.writable) {
							finish({readable: value.readable, writable: value.writable})
						} else {
							finish(null)
						}
					}
				)
				// A provider can answer during the dispatch above, in which case
				// `finish` ran while `unsubscribe` was still null. Tear down now.
				if (settled) {
					try {
						unsubscribe?.()
					} catch {}
				}
			})
			.catch((err) => {
				console.error("[patchwork-worker] failed to load patchwork-providers:", err)
				finish(null)
			})
	})
}

// A DOM node inside a mounted <patchwork-view> is needed to dispatch the
// discovery `patchwork:subscribe`. Consumers pass one via opts.element; when they
// don't, remember the most recent element any caller supplied (mirrors config.js's
// lastElement bootstrap), so elementless callers can still discover.
/** @type {HTMLElement | null} */
let lastElement = null

/** Record an element for elementless discovery (call from a UI that has one). */
export function rememberDiscoveryElement(element) {
	if (element) lastElement = element
}

function discoveryElement() {
	return lastElement
}

// --- Session layer ----------------------------------------------------------
// session.js takes `connectWorker` as a parameter rather than importing it, so
// the dependency runs one way and there's no import cycle.
export const openSession = createOpenSession(connectWorker)
