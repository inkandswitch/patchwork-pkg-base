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
 * the service package, so the frame vocabulary they share can never drift apart
 * across releases — and a tool that calls
 *
 *   const llm = await connectWorkerClient("llm", {sessionOpts: {idPrefix: "chat"}})
 *   await llm.generate(messages, {element, ...})
 *
 * has no build-time dependency on that package at all. The lookup is late-bound
 * through the registry (AGENTS.md's sanctioned coupling) and degrades to a
 * rejection if nothing registered the kind.
 *
 * Works in both realms. Inside an isolation iframe the plugin registry is
 * mirrored from the host (every registry type, ungated), the plugin's `load()`
 * fetches the service package's entry through the iframe module loader, and the
 * session is served by the host provider across the boundary — the same call.
 *
 * ⚠ This file is deliberately NOT re-exported from index.js. It imports
 * `@inkandswitch/patchwork-plugins` statically, whose graph reaches `window`;
 * index.js -> connect.js is the graph the module loader evaluates in a Worker
 * when it reads a package's `plugins`, and a bare import there kills it (see
 * connect.js). Nothing evaluates this file except a consumer that asked for it:
 * in the host it resolves through the bootloader importmap, in the iframe through
 * the es-module-shims importmap (which already loads patchwork-plugins for the
 * iframe's own registry). connect.test.js's "package shape" tests enforce the
 * split.
 */

import {getRegistry} from "@inkandswitch/patchwork-plugins"
import {openSession} from "./connect.js"

/**
 * The plugin type a service package registers to offer a typed client for its
 * worker. Paired with `patchwork:worker` by `id`. Also exported (as a bare
 * string) from index.js so naming it costs no import.
 */
export const WORKER_CLIENT_PLUGIN_TYPE = "patchwork:worker-client"

/**
 * How long to wait for the client plugin to be registered AND loaded before
 * giving up. `loadWhenReady` is unbounded by design (it waits for a late
 * registration — in the iframe, entries arrive via the bridge after the tool
 * may already have mounted), so this is the only thing standing between a
 * missing service package and a consumer that awaits forever.
 */
const LOAD_TIMEOUT_MS = 10000

/**
 * @typedef {ReturnType<typeof openSession>} WorkerSession
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
 *   sessionOpts?: {element?: HTMLElement, idPrefix?: string, onLog?: (...a:any[])=>void},
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
