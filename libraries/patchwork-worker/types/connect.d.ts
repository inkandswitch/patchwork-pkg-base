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
export function connectWorker(kind: string, opts: {
    element: HTMLElement;
}): Promise<WorkerConnection>;
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
export const CHANNEL_SELECTOR: "patchwork:worker-channel";
/**
 * The plugin type a service package registers to offer a worker. Its `id` is
 * the worker `kind`; `load()` resolves to a WorkerSpec (see ./serve.js).
 */
export const WORKER_PLUGIN_TYPE: "patchwork:worker";
/**
 * The paired plugin type a service package registers to offer a typed client
 * for its worker. Same `id` as the worker; `load()` resolves to a factory
 * `(session) => clientApi` (see ./client.js).
 */
export const WORKER_CLIENT_PLUGIN_TYPE: "patchwork:worker-client";
export const openSession: (kind: string, sessionOpts?: import("./session.js").SessionOpts) => import("./session.js").Session;
export type WorkerStreams = {
    readable: ReadableStream;
    writable: WritableStream;
};
export type WorkerConnection = WorkerStreams & {
    disconnect: () => void;
};
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
 */
export type WorkerSpec = {
    createWorker: () => Worker | Promise<Worker>;
    open?: (ctx: {
        element?: HTMLElement;
    }) => any;
    handle: (frame: any, io: any) => any;
    abort?: (token: any, post: (msg: any, transfer?: Transferable[]) => void) => void;
};
/**
 * The descriptor a package puts in its `plugins` array to offer a worker.
 */
export type WorkerPlugin = {
    type: "patchwork:worker";
    id: string;
    name?: string;
    load: () => Promise<WorkerSpec>;
};
