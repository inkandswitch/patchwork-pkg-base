/**
 * @typedef {import("./session.js").Session} WorkerSession
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
 *   sessionOpts?: import("./session.js").SessionOpts,
 *   timeoutMs?: number,
 * }} [opts]
 * @returns {Promise<any>}
 */
export function connectWorkerClient(kind: string, opts?: {
    sessionOpts?: import("./session.js").SessionOpts;
    timeoutMs?: number;
}): Promise<any>;
export type WorkerSession = import("./session.js").Session;
export type WorkerClientFactory = (session: WorkerSession) => any;
export type WorkerClientPlugin = {
    type: "patchwork:worker-client";
    id: string;
    name?: string;
    load: () => Promise<WorkerClientFactory>;
};
