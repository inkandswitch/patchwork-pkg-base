/**
 * The SERVING half of a worker connection — the mirror of `openSession`.
 *
 * `openSession` (session.js) is the consumer side: it owns a `{readable,
 * writable}` pair, mints request ids, multiplexes many requests over one
 * connection, and routes event frames back to the right caller. `serveWorkerSpec`
 * is the same machinery on the OTHER end. A worker library supplies a small
 * `WorkerSpec` — how to construct its worker, an optional per-connection warm-up,
 * and a `handle(frame)` that turns one consumer request into worker traffic — and
 * this file owns everything kind-agnostic around it:
 *
 *   - the `{readable, writable}` stream pair and its controller lifecycle
 *   - ONE dedicated Worker per connection, terminated on teardown (no reuse, no
 *     sharing — a worker belongs to the connection that opened it and dies with it)
 *   - id minting and demux for requests multiplexed within the connection
 *   - the reserved `op:"abort"` (session.js:168 already sends it, so it is part of
 *     the transport protocol, not any service's vocabulary)
 *   - teardown on cancel/close/abort of either stream
 *   - a bounded `open` hook (the same never-settling-primitive guard the rest of
 *     this package applies with LOAD_TIMEOUT_MS / DISCOVERY_TIMEOUT_MS)
 *
 * The spec knows nothing about streams, ids, or workers-as-transport; the
 * transport knows nothing about the service's op vocabulary, config, or secrets.
 */

/**
 * How long `spec.open` may take before the transport gives up and serves frames
 * anyway. Bounds an upstream primitive that can hang: a settings-doc warm resolves
 * through patchwork-providers' `request()`, which never settles if no provider
 * answers. Falling through is the spec's responsibility to make safe (the LLM
 * re-checks and retries); wedging every frame forever is strictly worse.
 */
const OPEN_TIMEOUT_MS = 5000

/**
 * @typedef {(msg: any, transfer?: Transferable[]) => void} Post
 * @typedef {(frame: any) => void} Emit
 *
 * @typedef {Object} IO  what a spec's `handle` is given
 * @property {Post} post              send a message to the worker (transfer supported)
 * @property {Emit} emit              enqueue a frame onto THIS consumer's readable
 * @property {(fn: (msg:any)=>boolean|void) => void} on
 *   register a handler for worker messages tagged with `workerId`; return a truthy
 *   value from `fn` when the request is complete and the transport should clean up
 * @property {string} workerId        the transport-minted id to tag worker payloads with
 * @property {any} state              whatever `spec.open` resolved (or null)
 * @property {{element?: HTMLElement}} ctx  host-realm context from the provider
 *
 * @typedef {Object} WorkerSpec
 * @property {() => Worker | Promise<Worker>} createWorker
 * @property {(ctx: {element?: HTMLElement}) => any} [open]
 * @property {(frame: any, io: IO) => any} handle
 *   returns an opaque abort token (or nothing) stored per request
 * @property {(token: any, post: Post) => void} [abort]
 */

let idSeq = 0
function nextWorkerId() {
	return "wk-" + ++idSeq + "-" + (performance.now() | 0)
}

/**
 * Serve one worker connection from a spec. Returns the `{readable, writable}` the
 * provider transfers to the consumer. One Worker is created for this connection
 * and terminated when either stream ends.
 *
 * @param {WorkerSpec} spec
 * @param {any} _request  the opening request (reserved; specs read per-frame data instead)
 * @param {{element?: HTMLElement}} [ctx]
 * @returns {{readable: ReadableStream, writable: WritableStream}}
 */
export function serveWorkerSpec(spec, _request, ctx = {}) {
	/** @type {Worker | null} */
	let worker = null
	/** @type {Promise<Worker> | null} */
	let workerReady = null
	// worker message id -> handler. One connection, so one flat map is enough.
	/** @type {Map<string, (msg:any)=>boolean|void>} */
	const handlers = new Map()
	// caller id -> the abort token the spec returned, so `op:"abort"` can cancel it.
	// A request is entered here SYNCHRONOUSLY at the value `PENDING` the moment its
	// frame arrives, before any await — so an `op:"abort"` that races in while the
	// spec is still resolving (`await openState` / `await spec.handle`) finds the
	// request and is honoured once the token lands, rather than being silently
	// dropped. The value becomes the real token (or `undefined`) when `handle`
	// returns; see the `PENDING`/`aborted` handling in `handleFrame`.
	/** @type {Map<string, any>} */
	const tokens = new Map()
	// caller ids aborted while still `PENDING` — the token wasn't available yet, so
	// the abort is deferred to when the handler stores it.
	/** @type {Set<string>} */
	const aborted = new Set()
	const PENDING = Symbol("pending")

	/** @type {ReadableStreamDefaultController | null} */
	let controller = null
	let closed = false

	const emit = (/** @type {any} */ frame) => {
		try {
			controller?.enqueue(frame)
		} catch {}
	}

	// The connection's one warm-up, bounded so a never-settling `open` can't wedge
	// every frame. Started eagerly; frames await it before dispatch.
	const openState = spec.open
		? Promise.race([
				Promise.resolve(spec.open(ctx)),
				new Promise((resolve) => setTimeout(resolve, OPEN_TIMEOUT_MS, null)),
			]).catch(() => null)
		: Promise.resolve(null)

	const post = (/** @type {any} */ msg, /** @type {Transferable[]=} */ transfer) => {
		void getWorker().then((w) => w.postMessage(msg, transfer || []))
	}

	/** Lazily construct the worker (once) and wire its message pump. */
	function getWorker() {
		if (workerReady) return workerReady
		workerReady = Promise.resolve(spec.createWorker()).then((w) => {
			worker = w
			w.onmessage = (/** @type {MessageEvent} */ ev) => dispatch(ev.data)
			return w
		})
		return workerReady
	}

	/**
	 * Route a worker message. A message with an `id` goes to that request's
	 * handler (which reports terminal by returning truthy). A message with no `id`
	 * (status, log, progress with no request attached) is emitted straight onto the
	 * connection's readable — with one worker per connection there is nothing to
	 * fan out to.
	 */
	function dispatch(/** @type {any} */ msg) {
		if (!msg || closed) return
		if (msg.id != null) {
			const h = handlers.get(msg.id)
			if (h && h(msg)) handlers.delete(msg.id)
			return
		}
		emit(msg)
	}

	async function handleFrame(/** @type {any} */ frame) {
		if (!frame || typeof frame !== "object") return
		const id = frame.id
		const op = frame.op

		// Reserved transport op. Cancel one in-flight request: let the spec send
		// whatever the worker needs, then forget it. If the request is still
		// `PENDING` (its handler hasn't returned a token yet — we're mid-`await`),
		// defer: record the id and let the handler abort as soon as it stores it.
		if (op === "abort") {
			if (!tokens.has(id)) return // unknown / already-finished request
			const token = tokens.get(id)
			if (token === PENDING) {
				aborted.add(id)
				return
			}
			try {
				spec.abort?.(token, post)
			} catch {}
			tokens.delete(id)
			return
		}

		// Claim the id SYNCHRONOUSLY, before the first await, so an abort racing in
		// during `await openState` / `await spec.handle` isn't dropped (H1).
		tokens.set(id, PENDING)

		const state = await openState
		const workerId = nextWorkerId()

		/** @type {IO} */
		const io = {
			post,
			// Frames the spec emits carry the WORKER id; re-tag with the caller id.
			emit: (f) => emit({...f, id}),
			on: (fn) => {
				handlers.set(workerId, (msg) => {
					const done = fn(msg)
					if (done) {
						tokens.delete(id)
						aborted.delete(id)
					}
					return done
				})
			},
			workerId,
			state,
			ctx,
		}

		try {
			const token = await spec.handle(frame, io)
			// An abort arrived while this request was still PENDING — honour it now
			// that the token exists, and don't store it (the request is cancelled).
			if (aborted.has(id)) {
				aborted.delete(id)
				tokens.delete(id)
				handlers.delete(workerId)
				try {
					spec.abort?.(token, post)
				} catch {}
				return
			}
			// Store the abort token even if undefined, so `op:"abort"` can find the
			// request (a spec that never aborts simply returns nothing).
			tokens.set(id, token)
		} catch (e) {
			const err = /** @type {any} */ (e)
			emit({id, type: "error", message: err?.message || String(e)})
			handlers.delete(workerId)
			tokens.delete(id)
			aborted.delete(id)
		}
	}

	function teardown() {
		if (closed) return
		closed = true
		handlers.clear()
		tokens.clear()
		aborted.clear()
		// Close the readable so a consumer still reading it sees end-of-stream rather
		// than hanging forever (H2). Teardown can be driven from the WRITABLE side
		// (close/abort) or worker death, where the readable was never cancelled; a
		// bare `controller = null` would strand that reader. `close()` throws if the
		// stream was already closed/cancelled (the readable-cancel path), so guard it.
		try {
			controller?.close()
		} catch {}
		controller = null
		// The worker belongs to this connection alone — kill it.
		try {
			worker?.terminate()
		} catch {}
		worker = null
	}

	const readable = new ReadableStream({
		start(c) {
			controller = c
		},
		cancel() {
			teardown()
		},
	})

	const writable = new WritableStream({
		write(frame) {
			void handleFrame(frame)
		},
		close() {
			teardown()
		},
		abort() {
			teardown()
		},
	})

	return {readable, writable}
}
