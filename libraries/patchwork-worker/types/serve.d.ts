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
export function serveWorkerSpec(spec: WorkerSpec, _request: any, ctx?: {
    element?: HTMLElement;
}): {
    readable: ReadableStream;
    writable: WritableStream;
};
export type Post = (msg: any, transfer?: Transferable[]) => void;
export type Emit = (frame: any) => void;
/**
 * what a spec's `handle` is given
 */
export type IO = {
    /**
     * send a message to the worker (transfer supported)
     */
    post: Post;
    /**
     * enqueue a frame onto THIS consumer's readable
     */
    emit: Emit;
    /**
     * register a handler for worker messages tagged with `workerId`; return a truthy
     * value from `fn` when the request is complete and the transport should clean up
     */
    on: (fn: (msg: any) => boolean | void) => void;
    /**
     * the transport-minted id to tag worker payloads with
     */
    workerId: string;
    /**
     * whatever `spec.open` resolved (or null)
     */
    state: any;
    /**
     * host-realm context from the provider
     */
    ctx: {
        element?: HTMLElement;
    };
};
export type WorkerSpec = {
    createWorker: () => Worker | Promise<Worker>;
    open?: ((ctx: {
        element?: HTMLElement;
    }) => any) | undefined;
    /**
     * returns an opaque abort token (or nothing) stored per request
     */
    handle: (frame: any, io: IO) => any;
    abort?: ((token: any, post: Post) => void) | undefined;
};
