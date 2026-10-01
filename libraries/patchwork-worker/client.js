/**
 * connectWorkerClient — resolve a worker's typed client from the plugin registry
 * and bind it to a session, so a consumer never imports the service package.
 *
 * The transport pairs two plugin types by `id` (the worker `kind`):
 *
 *   {type: "patchwork:worker",        id: "llm", load: () => spec}
 *   {type: "patchwork:worker-client", id: "llm", load: () => (session) => clientApi}
 *
 * The first is the SERVE half: the host-realm provider runs its WorkerSpec. The
 * second is the CONSUME half: a factory that turns an open `openSession(kind)`
 * session into the service's API (`{generate}` for the LLM, say). Both ship from
 * the service package, so the frame vocabulary they share cannot drift apart —
 * and a tool that calls
 *
 *   const llm = await connectWorkerClient("llm", {sessionOpts: {idPrefix: "chat"}})
 *   await llm.generate(messages, {element, ...})
 *
 * has no build-time dependency on that package. The lookup is late-bound through
 * the registry and rejects if nothing registered the kind.
 *
 * Works in any realm that has a plugin registry the service is registered in:
 * the lookup is an ordinary registry lookup, and the session is served by the
 * host provider wherever it is mounted, in-realm or across an isolation
 * boundary — the same call either way.
 *
 * Layering: this is the one file in the package that touches the plugin
 * registry. connect.js / session.js stay registry-free; serve.js is host-only
 * and is never imported here.
 */

import {getRegistry} from "@inkandswitch/patchwork-plugins"
import {openSession, WORKER_CLIENT_PLUGIN_TYPE} from "./connect.js"

/**
 * How long to wait for the client plugin to be registered AND loaded before
 * giving up. `loadWhenReady` is unbounded by design (it waits for a late
 * registration — in a sandboxed realm the service may be registered after the
 * consumer has already mounted), so this is the only thing standing between a
 * missing service package and a consumer that awaits forever.
 */
const LOAD_TIMEOUT_MS = 10000

/**
 * @typedef {import("./session.js").Session} WorkerSession
 * @typedef {(session: WorkerSession) => any} WorkerClientFactory
 * @typedef {{type: "patchwork:worker-client", id: string, name?: string, load: () => Promise<WorkerClientFactory>}} WorkerClientPlugin
 */

/**
 * Resolve the `patchwork:worker-client` plugin for `kind`, open a session for
 * the same kind, and return `factory(session)` — the service's client API.
 *
 * Rejects if no plugin for `kind` is registered and loaded within `timeoutMs`,
 * or if the plugin did not resolve to a function. Callers should not cache a
 * rejected result: a later call may succeed once the service package registers.
 *
 * @param {string} kind
 * @param {{
 *   sessionOpts?: import("./session.js").SessionOpts,
 *   timeoutMs?: number,
 * }} [opts]
 * @returns {Promise<any>}
 */
export async function connectWorkerClient(kind, opts = {}) {
	const registry = getRegistry(WORKER_CLIENT_PLUGIN_TYPE)
	const timeoutMs = opts.timeoutMs ?? LOAD_TIMEOUT_MS

	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`timed out loading worker-client plugin "${kind}"`)),
			timeoutMs
		)
	})
	let plugin
	try {
		// `loadWhenReady` (not `load`): a plugin registered-but-not-yet-loaded, or
		// registered after this call, still resolves instead of being reported
		// missing. The race bounds it.
		plugin = await Promise.race([registry.loadWhenReady(kind), timeout])
	} finally {
		clearTimeout(timer)
	}

	const factory = /** @type {any} */ (plugin)?.module
	if (typeof factory !== "function") {
		throw new Error(`worker-client plugin "${kind}" did not resolve to a factory`)
	}
	return factory(openSession(kind, opts.sessionOpts))
}
