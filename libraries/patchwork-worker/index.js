/**
 * @grjte/patchwork-worker — run a worker in the host realm, hand any consumer a
 * transferable stream pair, and have it work the same inside or outside a
 * Patchwork isolation boundary.
 *
 * This is a plain library. It registers no plugins; it is consumed as a
 * dependency, never installed as a module. Four pieces:
 *
 *   connect.js   the CONSUMER transport. `connectWorker(kind, request, {element})`
 *                returns `{readable, writable, disconnect}`. This is the only file
 *                a sandboxed tool loads.
 *   session.js   `openSession(kind)` — request/response multiplexing over that
 *                stream pair: id tagging, demux, abort, reconnect.
 *   serve.js     `serveWorkerSpec(spec, request, ctx)` — the SERVING half: runs
 *                one worker per connection and owns the stream pair + id demux.
 *   client.js    `connectWorkerClient(kind, opts)` — resolves the service's
 *                typed client from the `patchwork:worker-client` registry and
 *                binds it to `openSession(kind)`. Subpath-only; NOT re-exported
 *                here (its patchwork-plugins import cannot load in the module
 *                loader's Worker, which evaluates this entry).
 *
 * The host-realm PROVIDER that answers `patchwork:worker-channel` subscriptions
 * (`patchwork-worker-provider`, a `patchwork:component`) ships from the
 * `providers` package. It resolves a WorkerSpec for the requested `kind` from the
 * `patchwork:worker` plugin registry and drives it with `serveWorkerSpec`.
 *
 * Offering a worker is declarative — a package registers a PAIR of plugins under
 * one id (the worker `kind`), and nothing imports it until someone connects:
 *
 *   export const plugins = [
 *     {type: "patchwork:worker",        id: "llm", name: "LLM",
 *      async load() { return makeLLMWorkerSpec(...) }},        // serve half
 *     {type: "patchwork:worker-client", id: "llm", name: "LLM client",
 *      async load() { return makeLLMClient }},                 // consume half
 *   ]
 *
 * where the worker's `load()` resolves to a WorkerSpec — `{createWorker, open?,
 * handle, abort?}` — and the client's resolves to `(session) => clientApi`. A
 * tool then calls `connectWorkerClient("llm")` and gets the API without a
 * build-time dependency on the service package.
 *
 * ⚠ Nothing in this package may hold host-only state or secrets. connect.js is
 * fetched INTO the sandbox, and the isolation registry marker is per package, so
 * an isolated tool can reach any file here. Host-realm work belongs in the
 * provider (providers package) or in the service package that owns the worker.
 */

export {
	connectWorker,
	rememberDiscoveryElement,
	openSession,
	CHANNEL_SELECTOR,
} from "./connect.js"

/**
 * Types a package registering a worker needs, re-exported so it can type its
 * `load()` without reaching into the subpath.
 * @typedef {import("./connect.js").WorkerSpec} WorkerSpec
 * @typedef {import("./connect.js").WorkerPlugin} WorkerPlugin
 * @typedef {import("./connect.js").WorkerStreams} WorkerStreams
 * @typedef {import("./connect.js").WorkerConnection} WorkerConnection
 */

/**
 * The plugin type a package registers to offer a worker. A plain string, so
 * naming it costs no import.
 */
export const WORKER_PLUGIN_TYPE = "patchwork:worker"

/**
 * The paired plugin type a package registers to offer a typed client for its
 * worker (see ./client.js). Same id as the worker. A plain string here so the
 * entry never imports client.js.
 */
export const WORKER_CLIENT_PLUGIN_TYPE = "patchwork:worker-client"
