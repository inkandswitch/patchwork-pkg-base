/**
 * @param {WorkerSpec} spec
 * @param {ServeContext} [ctx]
 * @returns {{readable: ReadableStream, writable: WritableStream}}
 */
export function serveWorkerSpec(spec: WorkerSpec, ctx?: ServeContext): {
    readable: ReadableStream;
    writable: WritableStream;
};
export type Post = (msg: any, transfer?: Transferable[]) => void;
export type Emit = (frame: any) => void;
export type IO = {
    /**
     * send to the worker
     */
    post: Post;
    /**
     * enqueue a frame (tagged with the caller id) onto the readable
     */
    emit: Emit;
    /**
     * handle worker messages
     * tagged `workerId`; return truthy when done. Without `on`, a request is
     * fire-and-forget and can't be aborted.
     */
    on: (fn: (msg: any) => boolean | void) => void;
    workerId: string;
    /**
     * what `spec.open` resolved, or null
     */
    state: any;
    /**
     * Host-realm context from whoever serves the spec: an element inside a mounted
     * view (to reach providers) and the repo to resolve documents in.
     */
    ctx: ServeContext;
};
export type ServeContext = {
    element?: HTMLElement;
    repo?: unknown;
};
export type WorkerSpec = {
    createWorker: () => Worker | Promise<Worker>;
    open?: ((ctx: ServeContext) => any) | undefined;
    /**
     * returns an abort token
     */
    handle: (frame: any, io: IO) => any;
    abort?: ((token: any, post: Post) => void) | undefined;
};
