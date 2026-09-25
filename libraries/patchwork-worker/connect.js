/**
 * connectWorker — a generic, transferable-stream connection to a worker-backed
 * service.
 *
 * A tool asks to connect to a worker of some `kind` and, for the lifetime of
 * that connection, holds a `WritableStream` (to send request frames) and a
 * `ReadableStream` (to receive event frames). The worker itself, and any
 * privileged setup it needs (config/secrets), live on whichever side answers the
 * connection — the SAME realm when there's no isolation boundary, or the host
 * realm when the consumer runs in a sandboxed realm. Either way the consumer sees
 * an identical `{readable, writable}` pair; the streams are transferable, so they
 * cross an isolation boundary unchanged.
 *
 * This file is the CONSUMER half. `connectWorker(kind, {element})` returns
 * `{readable, writable, disconnect}`; a provider answers via the discovery event
 * (in-realm, or relayed from the host realm by whatever isolation mechanism is
 * in use). If nothing answers, it rejects. There is no local fallback.
 *
 * The SERVING half is `serveWorkerSpec` (./serve.js), driven by the host-realm
 * `patchwork-worker-provider` component (shipped by the `providers` package),
 * which resolves a WorkerSpec for the requested `kind` from the
 * `patchwork:worker` plugin registry. Consumers never import serve.js.
 *
 * This module is service-agnostic: it knows nothing about LLMs. Frame shapes are
 * the service's concern; connect.js treats them as opaque structured-cloneable
 * values, tagged with an `id` so many requests can multiplex over one connection.
 *
 * Discovery/handoff goes through patchwork-providers: this file calls
 * `subscribe()` and the host provider answers with `accept()`. The stream pair
 * rides in the value; `respond`'s transfer list moves rather than clones it, so
 * the streams stay live across the isolation boundary.
 *
 * Layering: this file stays free of the plugin registry so the sandbox-loaded
 * transport carries no more than it needs; the registry lookup lives in
 * ./client.js.
 */

import {createOpenSession} from "./session.js"

// --- Protocol constants -----------------------------------------------------
// Deliberately STRINGS, not Symbols. Comparisons against them are `===` on the
// value (here, in the host worker provider, and possibly as inlined literals in
// code that relays the subscription across a boundary), so they keep working
// even if this module is evaluated more than once. A Symbol would silently stop
// matching.

/**
 * The selector type used to discover a worker-connection provider. A consumer
 * dispatches a `patchwork:subscribe` for `{ type: CHANNEL_SELECTOR, kind }`
 * carrying a MessagePort in `detail.port`. The answering side replies over that
 * port, in the standard providers envelope (`{type:"change", value}`), with
 * exactly one of:
 *
 *   {readable, writable}  — success; the pair is TRANSFERRED, not cloned
 *   null                  — refused; fail fast
 *
 * Silence is also a valid outcome (nothing is mounted to answer), which the
 * consumer's bounded discovery timeout covers. Answering sides that KNOW they're
 * refusing should respond `null` rather than staying silent.
 */
export const CHANNEL_SELECTOR = "patchwork:worker-channel"

/**
 * The plugin type a service package registers to offer a worker. Its `id` is
 * the worker `kind`; `load()` resolves to a WorkerSpec (see ./serve.js).
 */
export const WORKER_PLUGIN_TYPE = "patchwork:worker"

/**
 * The paired plugin type a service package registers to offer a typed client
 * for its worker. Same `id` as the worker; `load()` resolves to a factory
 * `(session) => clientApi` (see ./client.js).
 */
export const WORKER_CLIENT_PLUGIN_TYPE = "patchwork:worker-client"

/**
 * BACKSTOP: how long to wait for a provider to answer before giving up.
 *
 * Not control flow. A mounted provider either serves the kind (streams) or
 * refuses it (`null`), and both are immediate — so in a healthy frame this timer
 * never fires. It exists because an unclaimed `patchwork:subscribe` never
 * settles by design (a subscription may wait for a provider that mounts later).
 * Without a bound, a missing provider would hang the caller forever instead of
 * erroring.
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
 * (Shape mirrored from serve.js's `WorkerSpec`, kept as a local typedef so this
 * sandbox-loaded file does not import the host-only serve module. Types erase,
 * so this costs nothing at runtime.)
 * @typedef {{
 *   createWorker: () => Worker | Promise<Worker>,
 *   open?: (ctx: {element?: HTMLElement}) => any,
 *   handle: (frame: any, io: import("./serve.js").IO) => any,
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
 * A `patchwork:subscribe` provider for `{type: CHANNEL_SELECTOR, kind}` above
 * `element` answers, transferring streams back over the port. In the host realm
 * that's a mounted worker provider; in a sandboxed realm it's whatever relays
 * the subscription to the host and transfers the host's streams back across the
 * boundary. The consumer gets the same `{readable, writable, disconnect}` either
 * way and never learns which answered.
 *
 * There is deliberately NO fallback to a locally-constructed worker. Inside the
 * sandbox that fallback was a hole: any in-boundary tool that imported a service
 * package would register its worker as an import side-effect, and a connection
 * that should have been refused would instead run the worker in the opaque
 * origin — no shared model cache, no host config, and no signal that the
 * isolation boundary had been bypassed. Serving is the provider's job; a
 * consumer with no provider ancestor fails loudly instead.
 *
 * @param {string} kind
 * @param {{ element: HTMLElement }} opts  a node inside a mounted <patchwork-view>,
 *   to dispatch the discovery subscribe from
 * @returns {Promise<WorkerConnection>}
 */
export async function connectWorker(kind, opts) {
	const el = opts?.element
	if (!el) {
		throw new Error(
			`no worker available for kind "${kind}": no element to discover a provider from`
		)
	}
	const streams = await discoverViaProvider(el, kind)
	if (!streams) {
		throw new Error(`no worker available for kind "${kind}"`)
	}
	return withDisconnect(streams)
}

/**
 * Wrap a {readable, writable} with a disconnect() that tears both ends down.
 * Only valid while the caller holds no reader/writer lock (a locked stream
 * rejects cancel/abort); a consumer that has taken locks releases through them.
 * @param {WorkerStreams} streams
 * @returns {WorkerConnection}
 */
function withDisconnect(streams) {
	return {
		...streams,
		disconnect() {
			streams.readable.cancel().catch(() => {})
			streams.writable.abort().catch(() => {})
		},
	}
}

/**
 * Ask a `patchwork:worker-channel` provider to open a connection, via providers
 * `subscribe()`. Resolves null on an explicit refusal, or if nothing answers
 * within the discovery timeout.
 *
 * @param {HTMLElement} element
 * @param {string} kind
 * @returns {Promise<WorkerStreams | null>}
 */
function discoverViaProvider(element, kind) {
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

		// `subscribe` is typed `T extends JSONValue`, but a transferred stream pair
		// is not JSON — the cast is that constraint biting. `accept<T = JSONValue>`
		// is deliberately unconstrained for exactly this case; the consumer half
		// was never widened to match. Worth fixing upstream.
		void import("@inkandswitch/patchwork-providers")
			.then(({subscribe}) => {
				if (settled) return
				unsubscribe = /** @type {any} */ (subscribe)(
					element,
					{type: CHANNEL_SELECTOR, kind},
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

// --- Session layer ----------------------------------------------------------
// session.js takes `connectWorker` as a parameter rather than importing it, so
// the dependency runs one way and there's no import cycle.
export const openSession = createOpenSession(connectWorker)
