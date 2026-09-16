/**
 * The LLM consume-half — the mirror of worker-spec.js.
 *
 * worker-spec.js (the SERVE half) turns a consumer's request frames into worker
 * traffic; this file (the CONSUME half) turns a tool's `generate(...)` call into
 * those request frames and reads the event stream back. Together they are the LLM
 * *protocol* layer, sitting above the generic transport (@grjte/patchwork-worker)
 * and below any tool that wants to generate.
 *
 * ⚠ PURE by design — this file imports NOTHING. The transport is injected: a tool
 * opens a session with @grjte/patchwork-worker's `openSession` and passes it to
 * `makeGenerate`. That keeps this file a raw sandbox-safe subpath (like the
 * transport's connect.js) with no cross-package import to bake, and it mirrors the
 * transport's own shape — `createOpenSession(connectWorker)` injects its primitive
 * the same way. The tool owns the CONNECTION (which worker kind, when to open);
 * this file owns only the PROTOCOL.
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
 */

/**
 * Build a `generate` bound to an already-open transport session. The tool opens
 * the session (`openSession("llm", {...})` from @grjte/patchwork-worker) and hands
 * it in; this file only ever calls `session.request(...)`.
 *
 * @param {{request: (frame:any, opts:any)=>{promise:Promise<any>}}} session
 */
export function makeGenerate(session) {
	/**
	 * Generate a completion. Streams tokens via opts.onToken; resolves with the
	 * final text + any structured tool calls. Tool EXECUTION stays in the tool —
	 * the worker only receives tool descriptors and returns calls to run.
	 * @param {any[]|string} messages
	 * @param {GenOpts} [opts]
	 * @returns {Promise<GenResult>}
	 */
	return function generate(messages, opts = {}) {
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
}

/**
 * @typedef {{name: string, args: Record<string, any>}} ToolCall
 */

/**
 * Extract tool calls from a model's text output, for providers without native
 * function calling (local / template). Handles LFM bracket syntax, `<tool_call>`
 * XML, and fenced/bare JSON. Pure text — copied from @chee/patchwork-llm's
 * tools.js (the repo's standalone-package rule forbids linking, so a copy is the
 * sanctioned answer; it lives here, in the protocol layer, once for every LLM
 * consumer instead of once per tool).
 *
 * @param {string} text
 * @returns {ToolCall[]}
 */
export function parseToolCalls(text) {
	if (!text) return []
	/** @type {ToolCall[]} */
	const calls = []
	const push = (/** @type {any} */ obj) => {
		const name = obj?.name || obj?.tool
		if (!name) return
		let args = obj.arguments ?? obj.args ?? {}
		if (typeof args === "string") {
			try {
				args = JSON.parse(args)
			} catch {
				args = {}
			}
		}
		calls.push({name, args: args || {}})
	}
	const thinkingEnd = text.lastIndexOf("</think>")
	const lfmRegionStart = thinkingEnd === -1 ? 0 : thinkingEnd + "</think>".length
	const lfmMatch = text
		.slice(lfmRegionStart)
		.search(/\[\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\(/)
	const lfmStart = lfmMatch === -1 ? -1 : lfmRegionStart + lfmMatch
	if (lfmStart !== -1) {
		let depth = 0
		let quote = ""
		let escaped = false
		let lfmEnd = -1
		for (let i = lfmStart; i < text.length; i++) {
			const ch = text[i]
			if (escaped) {
				escaped = false
				continue
			}
			if (quote) {
				if (ch === "\\") escaped = true
				else if (ch === quote) quote = ""
				continue
			}
			if (ch === "'" || ch === '"') {
				quote = ch
				continue
			}
			if (ch === "[" || ch === "(" || ch === "{") depth++
			else if (ch === "]" || ch === ")" || ch === "}") {
				depth--
				if (depth === 0) {
					lfmEnd = i
					break
				}
			}
		}
		if (lfmEnd !== -1) {
			const split = (source = "") => {
				const parts = []
				let start = 0
				let nested = 0
				let string = ""
				let slash = false
				for (let i = 0; i < source.length; i++) {
					const ch = source[i]
					if (slash) {
						slash = false
						continue
					}
					if (string) {
						if (ch === "\\") slash = true
						else if (ch === string) string = ""
						continue
					}
					if (ch === "'" || ch === '"') string = ch
					else if (ch === "[" || ch === "(" || ch === "{") nested++
					else if (ch === "]" || ch === ")" || ch === "}") nested--
					else if (ch === "," && nested === 0) {
						parts.push(source.slice(start, i).trim())
						start = i + 1
					}
				}
				const last = source.slice(start).trim()
				if (last) parts.push(last)
				return parts
			}
			const literal = (source = "") => {
				let json = ""
				for (let i = 0; i < source.length; i++) {
					const ch = source[i]
					if (ch !== "'" && ch !== '"') {
						json += ch
						continue
					}
					let value = ""
					for (i++; i < source.length; i++) {
						const next = source[i]
						if (next === ch) break
						if (next !== "\\") {
							value += next
							continue
						}
						const escaped = source[++i]
						value +=
							escaped === "n"
								? "\n"
								: escaped === "r"
									? "\r"
									: escaped === "t"
										? "\t"
										: escaped
					}
					json += JSON.stringify(value)
				}
				try {
					return JSON.parse(
						json.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null")
					)
				} catch {
					return source
				}
			}
			for (const expression of split(text.slice(lfmStart + 1, lfmEnd))) {
				const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*)\)$/.exec(expression)
				if (!match) continue
				const args = Object.fromEntries([])
				for (const arg of split(match[2])) {
					const eq = arg.indexOf("=")
					if (eq < 1) continue
					const name = arg.slice(0, eq).trim()
					if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) continue
					args[name] = literal(arg.slice(eq + 1).trim())
				}
				calls.push({name: match[1], args})
			}
			if (calls.length) return calls
		}
	}
	let m
	const xml = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
	let sawXml = false
	while ((m = xml.exec(text))) {
		sawXml = true
		try {
			push(JSON.parse(m[1].trim()))
		} catch {}
	}
	if (sawXml) return calls
	const fence = /```(?:json|tool[_-]call)?\s*([\s\S]*?)```/g
	while ((m = fence.exec(text))) {
		try {
			push(JSON.parse(m[1].trim()))
		} catch {}
	}
	if (calls.length) return calls
	// Bare JSON objects — brace-depth-aware scan so nested objects (e.g.
	// "arguments": { ... }) are captured whole instead of truncated at the
	// first inner `}`.
	let depth = 0,
		start = -1,
		inStr = false,
		esc = false
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (esc) {
			esc = false
			continue
		}
		if (ch === "\\" && inStr) {
			esc = true
			continue
		}
		if (ch === '"') {
			inStr = !inStr
			continue
		}
		if (inStr) continue
		if (ch === "{") {
			if (depth === 0) start = i
			depth++
		} else if (ch === "}") {
			depth--
			if (depth === 0 && start >= 0) {
				const block = text.slice(start, i + 1)
				if (/"(?:name|tool)"/.test(block)) {
					try {
						push(JSON.parse(block))
					} catch {}
				}
				start = -1
			}
		}
	}
	return calls
}
