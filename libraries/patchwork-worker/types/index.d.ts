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
export const WORKER_PLUGIN_TYPE: "patchwork:worker";
/**
 * The paired plugin type a package registers to offer a typed client for its
 * worker (see ./client.js). Same id as the worker. A plain string here so the
 * entry never imports client.js.
 */
export const WORKER_CLIENT_PLUGIN_TYPE: "patchwork:worker-client";
/**
 * Types a package registering a worker needs, re-exported so it can type its
 * `load()` without reaching into the subpath.
 */
export type WorkerSpec = import("./connect.js").WorkerSpec;
/**
 * Types a package registering a worker needs, re-exported so it can type its
 * `load()` without reaching into the subpath.
 */
export type WorkerPlugin = import("./connect.js").WorkerPlugin;
/**
 * Types a package registering a worker needs, re-exported so it can type its
 * `load()` without reaching into the subpath.
 */
export type WorkerStreams = import("./connect.js").WorkerStreams;
/**
 * Types a package registering a worker needs, re-exported so it can type its
 * `load()` without reaching into the subpath.
 */
export type WorkerConnection = import("./connect.js").WorkerConnection;
export { connectWorker, rememberDiscoveryElement, openSession, CHANNEL_SELECTOR } from "./connect.js";
