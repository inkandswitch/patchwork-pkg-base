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
export function createOpenSession(connectWorker: (kind: string, request: any, opts?: any) => Promise<any>): (kind: string, sessionOpts?: {
    element?: HTMLElement;
    idPrefix?: string;
    onLog?: (...a: any[]) => void;
}) => {
    request: (frame: any, opts: RequestOpts) => {
        promise: Promise<any>;
        abort: () => void;
    };
    /** Send a fire-and-forget frame (no id correlation, no reply expected). */
    notify: (frame: any, element: any) => Promise<void>;
};
export type RequestOpts = {
    /**
     * frame.type -> settle. The
     * return value resolves the request; throw to reject it. Any type listed here
     * ends the request.
     */
    terminal: Record<string, (frame: any) => any>;
    /**
     * every non-terminal frame for this id
     */
    onFrame?: ((frame: any) => void) | undefined;
    /**
     * aborting sends {op:"abort", id} and rejects
     */
    signal?: AbortSignal | undefined;
    /**
     * discovery element, if not set on the session
     */
    element?: HTMLElement | undefined;
};
