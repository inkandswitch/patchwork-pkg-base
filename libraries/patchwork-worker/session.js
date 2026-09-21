/**
 * openSession — request/response multiplexing over a worker connection.
 *
 * `connectWorker` gives you a raw `{readable, writable}` pair. This module owns
 * the layer every consumer needs on top of it: open the connection lazily, keep
 * one writer, pump the readable, tag each request with an id, route event frames
 * back to the right in-flight caller, and settle on a terminal frame. It stays
 * service-agnostic: frames are opaque, and the caller says which `type` values
 * are terminal.
 *
 *   const session = openSession("llm", {element})
 *   const {promise, abort} = session.request(
 *     {op: "generate", messages},
 *     {
 *       terminal: {result: (f) => f.text, error: (f) => { throw new Error(f.message) }},
 *       onFrame: (f) => { if (f.type === "token") ui.append(f.delta) },
 *       signal,
 *     }
 *   )
 *
 * Frame routing: a frame with an `id` goes to that request's `onFrame` (or its
 * terminal handler). A frame with NO id is a connection-wide broadcast from the
 * worker — a status or progress message not tied to one request — and is
 * delivered to every in-flight request's `onFrame`, so a caller sees the
 * worker's status the same way it would from a same-realm worker.
 *
 * Connection lifetime: opened on the first request, shared by every request
 * after it, and DROPPED whenever it fails or ends — so the next request
 * reconnects instead of replaying a dead or rejected connection forever.
 * `close()` drops it on purpose (and terminates the host worker behind it).
 *
 * This module does not import ./connect.js. `connectWorker` is injected by
 * `createOpenSession`, so the dependency runs one way (connect.js -> session.js).
 */

/**
 * @typedef {Object} RequestOpts
 * @property {Record<string, (frame:any)=>any>} terminal  frame.type -> settle. The
 *   return value resolves the request; throw to reject it. Any type listed here
 *   ends the request.
 * @property {(frame:any)=>void} [onFrame]  every non-terminal frame for this id,
 *   plus every id-less broadcast frame received while the request is in flight
 * @property {AbortSignal} [signal]  aborting sends {op:"abort", id} and rejects
 * @property {HTMLElement} [element]  discovery element, if not set on the session
 *
 * @typedef {Object} SessionOpts
 * @property {HTMLElement} [element]  default discovery element for every request
 * @property {string} [idPrefix]      request id prefix (defaults to the kind)
 * @property {(...a:any[])=>void} [onLog]
 *
 * @typedef {{readable: ReadableStream, writable: WritableStream, disconnect: () => void}} Connection
 * @typedef {Connection & {writer: WritableStreamDefaultWriter, reader: ReadableStreamDefaultReader}} OpenConnection
 *
 * @typedef {Object} Session
 * @property {(frame: any, opts: RequestOpts) => {promise: Promise<any>, abort: () => void}} request
 * @property {() => void} close  drop the connection (terminating the worker behind
 *   it) and reject every in-flight request; the next request reconnects
 */

/**
 * Build the `openSession` export, bound to a `connectWorker` implementation.
 * Called once from connect.js; consumers use the resulting `openSession`.
 *
 * @param {(kind: string, opts: {element: HTMLElement}) => Promise<Connection>} connectWorker
 */
export function createOpenSession(connectWorker) {
	/**
	 * Open a lazily-connected, multiplexed session for a worker `kind`.
	 *
	 * @param {string} kind
	 * @param {SessionOpts} [sessionOpts]
	 * @returns {Session}
	 */
	return function openSession(kind, sessionOpts = {}) {
		const idPrefix = sessionOpts.idPrefix || kind
		const log = sessionOpts.onLog || (() => {})

		/** @type {Promise<OpenConnection>|null} */
		let connectionPromise = null
		/** id -> handlers for every request still in flight
		 * @type {Map<string, {onFrame: (f:any)=>void, onClosed: (cause:any)=>void}>} */
		const handlers = new Map()
		let idSeq = 0

		const nextId = () => idPrefix + "-" + ++idSeq + "-" + (performance.now() | 0)

		/**
		 * Drop the cached connection, and FAIL everything still in flight on it.
		 *
		 * Uncaching matters because a single failure (requesting before the provider
		 * has mounted, say) would otherwise be cached and every later request would
		 * fail instantly with the stale error, and a normally-closed connection would
		 * never reopen.
		 *
		 * Failing the in-flight requests matters more. They are waiting on frames
		 * that can no longer arrive. Leaving them in `handlers` would orphan each
		 * promise forever — no rejection, no timeout — and a consumer awaiting with
		 * no deadline would wedge with no error to show.
		 * @param {any} cause
		 */
		function reset(cause) {
			connectionPromise = null
			const inFlight = [...handlers.values()]
			handlers.clear()
			for (const h of inFlight) h.onClosed(cause)
		}

		/** @param {HTMLElement | undefined} element */
		function ensureConnection(element) {
			if (connectionPromise) return connectionPromise
			const el = element ?? sessionOpts.element
			connectionPromise = (async () => {
				const conn = await connectWorker(kind, {element: /** @type {HTMLElement} */ (el)})
				// Keep the reader and writer ON the connection, not in closure state:
				// `send` awaits `ensureConnection` and the connection can end during
				// that await, so shared variables may be null — or belong to a newer
				// connection — by the time they are used. Holding both locks also
				// means `close()` must release through them (a locked stream rejects
				// cancel/abort from anyone else).
				const open = /** @type {OpenConnection} */ (
					Object.assign(conn, {
						writer: conn.writable.getWriter(),
						reader: conn.readable.getReader(),
					})
				)
				void pump(open.reader)
				return open
			})()
			// Don't let an unawaited rejection surface as unhandled; just uncache it.
			connectionPromise.catch((e) => reset(e))
			return connectionPromise
		}

		/** @param {ReadableStreamDefaultReader} reader */
		async function pump(reader) {
			/** @type {any} */
			let cause = null
			try {
				while (true) {
					const {value, done} = await reader.read()
					if (done) break
					if (!value) continue
					if (value.id != null) {
						handlers.get(value.id)?.onFrame(value)
					} else {
						// Connection-wide broadcast: every in-flight request hears it.
						for (const h of [...handlers.values()]) h.onFrame(value)
					}
				}
			} catch (e) {
				cause = e
				log("connection readable errored", e)
			} finally {
				reset(cause)
			}
		}

		/**
		 * Write one frame, opening the connection if needed.
		 * @param {any} frame
		 * @param {HTMLElement | undefined} element
		 */
		async function send(frame, element) {
			const conn = await ensureConnection(element)
			await conn.writer.write(frame)
		}

		/**
		 * Issue one request. Returns the settle promise plus an `abort()`.
		 *
		 * @param {any} frame  the request frame (an `id` is added)
		 * @param {RequestOpts} opts
		 */
		function request(frame, opts) {
			const id = nextId()
			const terminal = opts.terminal || {}

			let settled = false
			/** @type {(v:any)=>void} */
			let resolveFn = () => {}
			/** @type {(e:any)=>void} */
			let rejectFn = () => {}

			const cleanup = () => {
				handlers.delete(id)
				opts.signal?.removeEventListener("abort", onAbort)
			}

			function onAbort() {
				if (settled) return
				settled = true
				// Only tell the service to stop if a connection exists or is opening:
				// an already-aborted signal must not open a whole connection (up to the
				// full discovery timeout) purely to abort a request that was never
				// sent. If the request frame is still in flight the abort simply
				// follows it; the serve half ignores aborts for ids it doesn't know.
				if (connectionPromise) void send({op: "abort", id}, opts.element).catch(() => {})
				cleanup()
				rejectFn(new DOMException("Aborted", "AbortError"))
			}

			const promise = new Promise((resolve, reject) => {
				resolveFn = resolve
				rejectFn = reject
			})

			handlers.set(id, {
				onFrame(f) {
					if (settled) return
					const settle = terminal[f.type]
					if (settle) {
						settled = true
						cleanup()
						try {
							resolveFn(settle(f))
						} catch (e) {
							rejectFn(e)
						}
						return
					}
					try {
						opts.onFrame?.(f)
					} catch (e) {
						log("onFrame threw", e)
					}
				},
				// The connection ended before a terminal frame arrived. Nothing more
				// can come, so fail rather than wait forever.
				onClosed(cause) {
					if (settled) return
					settled = true
					cleanup()
					rejectFn(
						cause instanceof Error
							? cause
							: new Error(`worker connection for "${kind}" closed before the request completed`)
					)
				},
			})

			if (opts.signal) {
				if (opts.signal.aborted) {
					onAbort()
					return {promise, abort: onAbort}
				}
				opts.signal.addEventListener("abort", onAbort)
			}

			send({...frame, id}, opts.element).catch((e) => {
				if (settled) return
				settled = true
				cleanup()
				rejectFn(e)
			})

			return {promise, abort: onAbort}
		}

		/**
		 * Close the connection on purpose. The serve half tears down its worker when
		 * the streams end; in-flight requests reject; the next request reconnects.
		 */
		function close() {
			const pending = connectionPromise
			if (!pending) return
			reset(new Error(`worker connection for "${kind}" was closed`))
			pending
				.then((conn) => {
					// Release through the locks this session holds: cancelling the
					// reader ends the pump; aborting the writer ends the serve half,
					// which terminates the worker.
					conn.reader.cancel().catch(() => {})
					conn.writer.abort().catch(() => {})
				})
				.catch(() => {})
		}

		return {request, close}
	}
}
