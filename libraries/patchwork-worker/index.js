/**
 * @grjte/patchwork-worker — run a worker in the host realm, hand any consumer a
 * transferable stream pair, and have it work the same inside or outside a
 * Patchwork isolation boundary.
 *
 * This is a plain library: it registers no plugins and is consumed as a
 * dependency, never installed as a module. Four pieces:
 *
 *   connect.js   the CONSUMER transport. `connectWorker(kind, {element})` returns
 *                `{readable, writable, disconnect}`; `openSession(kind)` layers
 *                request/response multiplexing on top. Also home to the protocol
 *                constants (`CHANNEL_SELECTOR`, the two plugin type strings).
 *   session.js   `openSession` internals: id tagging, demux, broadcast fan-out,
 *                abort, reconnect, close.
 *   serve.js     `serveWorkerSpec(spec, ctx)` — the SERVING half: runs one worker
 *                per connection and owns the stream pair + id demux. Host-only;
 *                driven by the `patchwork-worker-provider` component (shipped by
 *                the `providers` package), which resolves a WorkerSpec for the
 *                requested `kind` from the `patchwork:worker` plugin registry.
 *   client.js    `connectWorkerClient(kind)` — resolves the service's typed client
 *                from the `patchwork:worker-client` registry and binds it to
 *                `openSession(kind)`. The one file here that touches the registry.
 *
 * Offering a worker is declarative — a service package registers a PAIR of
 * plugins under one id (the worker `kind`), and nothing is imported until someone
 * connects:
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
 * ⚠ Nothing in this package may hold host-only state or secrets. connect.js and
 * client.js are loaded into the consumer's realm, sandboxed or not, and a
 * consumer that can load one file of a package should be assumed able to load
 * any of them. Host-realm work belongs in the provider (providers package) or in
 * the service package that owns the worker.
 */

export {
	connectWorker,
	openSession,
	CHANNEL_SELECTOR,
	WORKER_PLUGIN_TYPE,
	WORKER_CLIENT_PLUGIN_TYPE,
} from "./connect.js"

export {connectWorkerClient} from "./client.js"

/**
 * Types a service package needs to type its `plugins` entries.
 * @typedef {import("./connect.js").WorkerSpec} WorkerSpec
 * @typedef {import("./connect.js").WorkerPlugin} WorkerPlugin
 * @typedef {import("./connect.js").WorkerStreams} WorkerStreams
 * @typedef {import("./connect.js").WorkerConnection} WorkerConnection
 * @typedef {import("./client.js").WorkerClientPlugin} WorkerClientPlugin
 * @typedef {import("./client.js").WorkerClientFactory} WorkerClientFactory
 * @typedef {import("./session.js").Session} Session
 */
