/**
 * The LLM consume-half — the mirror of worker-spec.js.
 *
 * worker-spec.js (the SERVE half) turns a consumer's request frames into worker
 * traffic; this file (the CONSUME half) turns a tool's `generate(...)` call into
 * those request frames and reads the event stream back. Together they are the LLM
 * *protocol* layer, sitting above the generic transport (@grjte/patchwork-worker)
 * and below any tool that wants to generate.
 *
 * How a tool gets it: NOT by import. index.ts registers `makeLLMClient` as the
 * `patchwork:worker-client` plugin with id "llm", paired with the `patchwork:worker`
 * plugin of the same id. A tool calls the transport's
 * `connectWorkerClient("llm", …)`, which resolves this factory from the plugin
 * registry, opens a session for "llm", and returns `makeLLMClient(session)`. So
 * both halves of the protocol ship in this one package and cannot drift, and the
 * tool has no build-time dependency on it.
 *
 * ⚠ Imports NOTHING — and must never import @chee/patchwork-llm or
 * ./worker-spec.js. This chunk is what a sandboxed tool loads (via the plugin's
 * `load()`); the library and the serve half stay host-side.
 *
 * Tool calls: the serve half parses `<tool_call>` text host-side for providers
 * without native function calling, so `result.toolCalls` is populated (or null)
 * for every provider and a consumer never parses model text itself.
 *
 * Frame vocabulary (must stay in step with worker-spec.js):
 *   request:  {id, op:"generate", scope, system, tools, messages|text, sessionKey}
 *   events:   {id, type:"token"|"stats"|"prediction"|"status"|"model"|
 *                       "result"|"error", ...}   result/error terminal.
 */

/**
 * @typedef {Object} GenOpts
 * @property {any} [scope]              {toolId, docId} — the host resolves config for this scope
 * @property {string|Record<string,string>} [system]  string | {default, [provider]}
 * @property {any[]} [tools]            tool descriptors {name, description, defaultOff?, parameters?}
 * @property {string} [sessionKey]
 * @property {HTMLElement} [element]    a node in the mounted <patchwork-view>, for discovery
 * @property {AbortSignal} [signal]
 * @property {(delta:string, full:string)=>void} [onToken]
 * @property {(message:string)=>void} [onStatus]
 * @property {(label:string)=>void} [onModel]
 *
 * @typedef {Object} GenResult
 * @property {string} text
 * @property {any[]|null} toolCalls
 * @property {string} [toolMode]
 *
 * @typedef {{generate: (messages: any[]|string, opts?: GenOpts) => Promise<GenResult>}} LLMClient
 */

/**
 * The `patchwork:worker-client` factory for kind "llm": bind the LLM protocol to
 * an already-open transport session and return the client API.
 *
 * @param {{request: (frame:any, opts:any)=>{promise:Promise<any>}}} session
 * @returns {LLMClient}
 */
export function makeLLMClient(session) {
	/**
	 * Generate a completion. Streams tokens via opts.onToken; resolves with the
	 * final text + any structured tool calls. Tool EXECUTION stays in the tool —
	 * the worker only receives tool descriptors and returns calls to run.
	 * @param {any[]|string} messages
	 * @param {GenOpts} [opts]
	 * @returns {Promise<GenResult>}
	 */
	function generate(messages, opts = {}) {
		const payload = typeof messages === "string" ? {text: messages} : {messages}

		const {promise} = session.request(
			{
				op: "generate",
				sessionKey: opts.sessionKey,
				scope: opts.scope,
				system: opts.system,
				tools: opts.tools,
				...payload,
			},
			{
				element: opts.element,
				signal: opts.signal,
				terminal: {
					result: (/** @type {any} */ f) => ({
						text: f.text,
						toolCalls: f.toolCalls || null,
						toolMode: f.toolMode,
					}),
					error: (/** @type {any} */ f) => {
						throw new Error(f.message)
					},
				},
				// prediction / stats frames are ignored by the caller unless it asks.
				onFrame: (/** @type {any} */ f) => {
					if (f.type === "token") opts.onToken?.(f.delta, f.text)
					else if (f.type === "status") opts.onStatus?.(f.message)
					else if (f.type === "model") opts.onModel?.(f.label)
				},
			}
		)

		return /** @type {Promise<GenResult>} */ (promise)
	}

	return {generate}
}
