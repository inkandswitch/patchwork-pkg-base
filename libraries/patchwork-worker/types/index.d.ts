export { connectWorkerClient } from "./client.js";
/**
 * Types a service package needs to type its `plugins` entries.
 */
export type WorkerSpec = import("./connect.js").WorkerSpec;
/**
 * Types a service package needs to type its `plugins` entries.
 */
export type WorkerPlugin = import("./connect.js").WorkerPlugin;
/**
 * Types a service package needs to type its `plugins` entries.
 */
export type WorkerStreams = import("./connect.js").WorkerStreams;
/**
 * Types a service package needs to type its `plugins` entries.
 */
export type WorkerConnection = import("./connect.js").WorkerConnection;
/**
 * Types a service package needs to type its `plugins` entries.
 */
export type WorkerClientPlugin = import("./client.js").WorkerClientPlugin;
/**
 * Types a service package needs to type its `plugins` entries.
 */
export type WorkerClientFactory = import("./client.js").WorkerClientFactory;
/**
 * Types a service package needs to type its `plugins` entries.
 */
export type Session = import("./session.js").Session;
export { connectWorker, openSession, CHANNEL_SELECTOR, WORKER_PLUGIN_TYPE, WORKER_CLIENT_PLUGIN_TYPE } from "./connect.js";
