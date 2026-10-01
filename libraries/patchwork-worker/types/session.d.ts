/**
 * openSession — request/response multiplexing over a worker connection.
 *
 * `connectWorker` gives you a raw `{readable, writable}` pair. This module owns
 * the layer every consumer needs on top of it: open the connection lazily, keep
 * one writer, pump the readable, tag each request with an id, route event frames
 * back to the right in-flight caller, and settle on a terminal frame. It stays
 * service-agnostic: frames are opaque, and the caller says which `type` values
 * are terminal.
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
 * Frame routing: a frame with an `id` goes to that request's `onFrame` (or its
 * terminal handler). A frame with NO id is a connection-wide broadcast from the
 * worker — a status or progress message not tied to one request — and is
 * delivered to every in-flight request's `onFrame`, so a caller sees the
 * worker's status the same way it would from a same-realm worker.
 *
 * Connection lifetime: opened on the first request, shared by every request
 * after it, and DROPPED whenever it fails or ends — so the next request
 * reconnects instead of replaying a dead or rejected connection forever.
 * `close()` drops it on purpose (and terminates the host worker behind it).
 *
 * This module does not import ./connect.js. `connectWorker` is injected by
 * `createOpenSession`, so the dependency runs one way (connect.js -> session.js).
 */
/**
 * @typedef {Object} RequestOpts
 * @property {Record<string, (frame:any)=>any>} terminal  frame.type -> settle. The
 *   return value resolves the request; throw to reject it. Any type listed here
 *   ends the request.
 * @property {(frame:any)=>void} [onFrame]  every non-terminal frame for this id,
 *   plus every id-less broadcast frame received while the request is in flight
 * @property {AbortSignal} [signal]  aborting sends {op:"abort", id} and rejects
 * @property {HTMLElement} [element]  discovery element, if not set on the session
 *
 * @typedef {Object} SessionOpts
 * @property {HTMLElement} [element]  default discovery element for every request
 * @property {string} [idPrefix]      request id prefix (defaults to the kind)
 * @property {(...a:any[])=>void} [onLog]
 *
 * @typedef {{readable: ReadableStream, writable: WritableStream, disconnect: () => void}} Connection
 * @typedef {Connection & {writer: WritableStreamDefaultWriter, reader: ReadableStreamDefaultReader}} OpenConnection
 *
 * @typedef {Object} Session
 * @property {(frame: any, opts: RequestOpts) => {promise: Promise<any>, abort: () => void}} request
 * @property {() => void} close  drop the connection (terminating the worker behind
 *   it) and reject every in-flight request; the next request reconnects
 */
/**
 * Build the `openSession` export, bound to a `connectWorker` implementation.
 * Called once from connect.js; consumers use the resulting `openSession`.
 *
 * @param {(kind: string, opts: {element: HTMLElement}) => Promise<Connection>} connectWorker
 */
export function createOpenSession(connectWorker: (kind: string, opts: {
    element: HTMLElement;
}) => Promise<Connection>): (kind: string, sessionOpts?: SessionOpts) => Session;
export type RequestOpts = {
    /**
     * frame.type -> settle. The
     * return value resolves the request; throw to reject it. Any type listed here
     * ends the request.
     */
    terminal: Record<string, (frame: any) => any>;
    /**
     * every non-terminal frame for this id,
     * plus every id-less broadcast frame received while the request is in flight
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
export type SessionOpts = {
    /**
     * default discovery element for every request
     */
    element?: HTMLElement | undefined;
    /**
     * request id prefix (defaults to the kind)
     */
    idPrefix?: string | undefined;
    onLog?: ((...a: any[]) => void) | undefined;
};
export type Connection = {
    readable: ReadableStream;
    writable: WritableStream;
    disconnect: () => void;
};
export type OpenConnection = Connection & {
    writer: WritableStreamDefaultWriter;
    reader: ReadableStreamDefaultReader;
};
export type Session = {
    request: (frame: any, opts: RequestOpts) => {
        promise: Promise<any>;
        abort: () => void;
    };
    /**
     * drop the connection (terminating the worker behind
     * it) and reject every in-flight request; the next request reconnects
     */
    close: () => void;
};
