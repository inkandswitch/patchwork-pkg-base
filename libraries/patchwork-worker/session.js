/**
 * openSession — request/response multiplexing over a worker connection.
 *
 * `connectWorker` gives you a raw `{readable, writable}` pair. Every consumer
 * then writes the same layer on top of it: open the connection lazily, keep one
 * writer, pump the readable, tag each request with an id, route event frames
 * back to the right in-flight caller, and settle on a terminal frame. That layer
 * had been written three times (chat's llm-client, patchwork-llm's client, and
 * the mirror-image demux inside patchwork-llm's own service), which is also why
 * the same reconnect bug existed in three places.
 *
 * This module owns it once. It stays service-agnostic: frames are opaque, and
 * the caller says which `type` values are terminal.
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
 * Connection lifetime: opened on the first request, shared by every request
 * after it, and DROPPED whenever it fails or ends — so the next request
 * reconnects instead of replaying a dead or rejected connection forever.
 *
 * NOTE: this module deliberately does NOT import ./connect.js. `connectWorker`
 * is injected by `createOpenSession` instead, so the dependency runs one way
 * (connect.js -> session.js) and the package keeps a single entry point. See the
 * entry-point note in connect.js for why a second entry point is a hazard here.
 */

/**
 * @typedef {Object} RequestOpts
 * @property {Record<string, (frame:any)=>any>} terminal  frame.type -> settle. The
 *   return value resolves the request; throw to reject it. Any type listed here
 *   ends the request.
 * @property {(frame:any)=>void} [onFrame]  every non-terminal frame for this id
 * @property {AbortSignal} [signal]  aborting sends {op:"abort", id} and rejects
 * @property {HTMLElement} [element]  discovery element, if not set on the session
 */

/**
 * Build the `openSession` export, bound to a `connectWorker` implementation.
 * Called once from connect.js; consumers use the resulting `openSession`.
 *
 * @param {(kind: string, request: any, opts?: any) => Promise<any>} connectWorker
 */
export function createOpenSession(connectWorker) {
	/**
	 * Open a lazily-connected, multiplexed session for a worker `kind`.
	 *
	 * @param {string} kind
	 * @param {{element?: HTMLElement, idPrefix?: string, onLog?: (...a:any[])=>void}} [sessionOpts]
	 */
	return function openSession(kind, sessionOpts = {}) {
		const idPrefix = sessionOpts.idPrefix || kind
		const log = sessionOpts.onLog || (() => {})

		/** @type {Promise<any>|null} */
		let connectionPromise = null
		/** id -> {onFrame, onClosed} for every request still in flight */
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
		 * that can no longer arrive: the stream they were reading is gone. Leaving
		 * them in `handlers` orphans each promise forever — no rejection, no
		 * timeout, and their abort listeners stay attached to whatever signal the
		 * caller passed. A consumer that awaits generation with no deadline (chat
		 * does) wedges permanently with no error to show.
		 */
		function reset(cause) {
			connectionPromise = null
			const inFlight = [...handlers.values()]
			handlers.clear()
			for (const h of inFlight) h.onClosed(cause)
		}

		function ensureConnection(element) {
			if (connectionPromise) return connectionPromise
			const el = element ?? sessionOpts.element
			connectionPromise = (async () => {
				const conn = await connectWorker(kind, {}, {element: el})
				// Keep the writer ON the connection, not in closure state: `send`
				// awaits `ensureConnection` and the connection can end during that
				// await, so a shared `writer` variable may be null — or belong to a
				// newer connection — by the time the write lands.
				conn.writer = conn.writable.getWriter()
				void pump(conn.readable)
				return conn
			})()
			// Don't let an unawaited rejection surface as unhandled; just uncache it.
			connectionPromise.catch((e) => reset(e))
			return connectionPromise
		}

		async function pump(readable) {
			const reader = readable.getReader()
			/** @type {any} */
			let cause = null
			try {
				while (true) {
					const {value, done} = await reader.read()
					if (done) break
					const h = value && value.id != null && handlers.get(value.id)
					if (h) h.onFrame(value)
				}
			} catch (e) {
				cause = e
				log("connection readable errored", e)
			} finally {
				reset(cause)
			}
		}

		/** Write one frame, opening the connection if needed. */
		async function send(frame, element) {
			const conn = await ensureConnection(element)
			// Don't use `?.` here: silently resolving without writing would leave the
			// caller's request unsettled with no error to explain it.
			if (!conn.writer) throw new Error(`worker connection for "${kind}" is closed`)
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
			let resolveFn
			/** @type {(e:any)=>void} */
			let rejectFn

			const cleanup = () => {
				handlers.delete(id)
				opts.signal?.removeEventListener("abort", onAbort)
			}

			// Only tell the service to stop if we actually asked it to start. An
			// already-aborted signal would otherwise open a whole connection — up to
			// the full discovery timeout — purely to abort a request that was never
			// sent.
			let sent = false

			function onAbort() {
				if (settled) return
				settled = true
				if (sent) void send({op: "abort", id}, opts.element).catch(() => {})
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

			send({...frame, id}, opts.element).then(
				() => {
					sent = true
				},
				(e) => {
					if (settled) return
					settled = true
					cleanup()
					rejectFn(e)
				}
			)

			return {promise, abort: onAbort}
		}

		return {
			request,
			/** Send a fire-and-forget frame (no id correlation, no reply expected). */
			notify: (frame, element) => send(frame, element).catch(() => {}),
		}
	}
}
