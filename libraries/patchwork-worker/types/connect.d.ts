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
export function connectWorker(kind: string, request: any, opts?: {
    element?: HTMLElement | null;
    signal?: AbortSignal;
}): Promise<WorkerConnection>;
/** Record an element for elementless discovery (call from a UI that has one). */
export function rememberDiscoveryElement(element: any): void;
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
export const CHANNEL_SELECTOR: "patchwork:worker-channel";
export const openSession: (kind: string, sessionOpts?: {
    element?: HTMLElement;
    idPrefix?: string;
    onLog?: (...a: any[]) => void;
}) => {
    request: (frame: any, opts: RequestOpts) => {
        promise: Promise<any>;
        abort: () => void;
    };
    notify: (frame: any, element: any) => Promise<void>;
};
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
 * (Shape mirrored from serve.js's `WorkerSpec`; kept as a local typedef rather
 * than importing serve.js, because this file is the sandbox-loaded consumer half
 * and must not pull the host-only serve module into its graph. Types erase, so
 * this costs nothing at runtime.)
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
