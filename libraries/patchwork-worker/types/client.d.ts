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
export function connectWorkerClient(kind: string, opts?: {
    sessionOpts?: {
        element?: HTMLElement;
        idPrefix?: string;
        onLog?: (...a: any[]) => void;
    };
    timeoutMs?: number;
}): Promise<any>;
/**
 * The plugin type a service package registers to offer a typed client for its
 * worker. Paired with `patchwork:worker` by `id`. Also exported (as a bare
 * string) from index.js so naming it costs no import.
 */
export const WORKER_CLIENT_PLUGIN_TYPE: "patchwork:worker-client";
export type WorkerSession = ReturnType<typeof openSession>;
export type WorkerClientFactory = (session: WorkerSession) => any;
export type WorkerClientPlugin = {
    type: "patchwork:worker-client";
    id: string;
    name?: string;
    load: () => Promise<WorkerClientFactory>;
};
import { openSession } from "./connect.js";
