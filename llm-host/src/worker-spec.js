/**
 * The LLM WorkerSpec — the host-realm glue that turns @chee/patchwork-llm into a
 * `patchwork:worker` that @grjte/patchwork-worker can serve.
 *
 * The generic transport (@grjte/patchwork-worker/serve.js) owns the stream pair,
 * the per-connection worker lifetime, id demux, and abort plumbing. This file
 * owns everything LLM-specific: resolving config/secrets from the settings doc,
 * building tool schemas, the op vocabulary (generate / predict / the analytical
 * ops / preload), and the model label. None of that can live in the sandbox —
 * the settings doc is denylisted and the API key must never cross — which is why
 * it lives HERE, in the host-realm package, rather than in the library or in the
 * transport.
 *
 * `makeLLMWorkerSpec(lib)` takes the loaded @chee/patchwork-llm module (so this
 * file has no static dependency on it — llm-host loads the library from its
 * automerge doc at runtime) and returns the spec.
 *
 * Request preparation (prompt resolution, CallConfig, the native-vs-templated
 * tools decision, the builtin detour, the input shape, the worker payload) is
 * the library's `prepareGenerate` / `buildGeneratePayload` — the same code its
 * own same-realm `generate()` runs — so the two paths cannot diverge. What stays
 * here is host policy: which overrides a consumer may set, provider-conditional
 * system maps, `toolToggles`, and parsing `<tool_call>` text into `toolCalls` so
 * consumers (src/client.js, the consume half) never parse model output.
 */

/** @param {...any} args */
function clog(...args) {
	try {
		console.log("[llm-host]", ...args)
	} catch {}
}

/**
 * Resolve a (possibly provider-conditional) system prompt. `system` may be a
 * plain string (used as-is) or a map like `{default, local, openrouter, …}` —
 * the entry matching the provider wins, falling back to `default`.
 * @param {any} system
 * @param {string} provider
 */
function resolveSystemForProvider(system, provider) {
	if (system == null) return undefined
	if (typeof system === "string") return system
	if (typeof system === "object") return system[provider] ?? system.default ?? undefined
	return undefined
}

/**
 * Filter tool descriptors by the config's `toolToggles`. A tool is included
 * unless turned off (`toggles[name] === false`); a `defaultOff` tool is opt-in
 * (included only if `toggles[name] === true`). Matching is by descriptor `name`.
 * @param {any[]} tools
 * @param {Record<string, boolean>} toggles
 */
function filterToolsByToggles(tools, toggles) {
	if (!Array.isArray(tools)) return tools
	const t = toggles || {}
	return tools.filter((tool) => {
		if (tool && tool.defaultOff) return t[tool.name] === true
		return t[tool.name] !== false
	})
}

/**
 * Build the LLM WorkerSpec.
 * @param {any} lib  the loaded @chee/patchwork-llm module
 */
export function makeLLMWorkerSpec(lib) {
	const {
		createWorker,
		ensureConfig,
		ensureSettingsDoc,
		settingsDocHandle,
		callConfig,
		applyPrompts,
		effectiveSystem,
		describeConfig,
		fetchOpenRouterModels,
		builtinGenerate,
		resolveCfgPrompts,
		prepareGenerate,
		buildGeneratePayload,
		parseToolCalls,
	} = lib

	// OpenRouter catalogue cache (host-side): turning a model id into a human name
	// needs the catalogue. Fetch once and reuse; failure just yields the raw id.
	/** @type {any[]|null} */
	let openrouterModelsCache = null
	async function openrouterModels() {
		if (openrouterModelsCache) return openrouterModelsCache
		try {
			openrouterModelsCache = await fetchOpenRouterModels()
		} catch {
			openrouterModelsCache = []
		}
		return openrouterModelsCache
	}

	/**
	 * Human-readable label for the resolved config. Consults the OpenRouter
	 * catalogue for that provider. Never includes secrets.
	 * @param {any} cfg
	 */
	async function modelLabel(cfg) {
		try {
			const openrouter = cfg.provider === "openrouter" ? (await openrouterModels()) || [] : []
			return describeConfig(cfg, {openrouterModels: openrouter})
		} catch {
			return "the configured model"
		}
	}

	/**
	 * Resolve the unresolved config for a request frame — the DOM/repo-bound
	 * preamble. Config is resolved HERE from the frame's `scope`, never from a
	 * consumer-supplied `frame.config` (which would let a tool pick the provider
	 * AND supply its own key, defeating host-side resolution).
	 *
	 * @param {any} frame
	 * @param {Promise<any>|null} settingsWarm  the connection's in-flight
	 *   settings-doc resolution (spec.open), awaited before reading config.
	 */
	async function resolveCfg0(frame, settingsWarm) {
		if (settingsWarm) await settingsWarm
		let cfg0 = await ensureConfig(frame.scope)
		// Self-heal a cold config: `ensureConfig` resolves elementless and on its
		// retryable paths silently yields DEFAULTS (local model for an OpenRouter
		// account, or OpenRouter with an empty apiKey → 401). The warm normally
		// settles this; this retry covers a caller whose warm timed out, and
		// `ensureSettingsDoc` deliberately doesn't cache its null results.
		if (!settingsDocHandle()) {
			await ensureSettingsDoc()
			cfg0 = await ensureConfig(frame.scope)
		}
		return cfg0
	}

	/**
	 * Only the sampling knobs a consumer legitimately owns are forwarded to
	 * callConfig. The frame is NOT passed wholesale: callConfig also honours
	 * provider / apiKey / model / url overrides, so handing it the raw frame would
	 * let a consumer redirect generation at its own endpoint with its own key.
	 * @param {any} frame
	 */
	function samplingOverrides(frame) {
		return {
			temperature: frame.temperature,
			topP: frame.topP,
			topk: frame.topk,
			maxNewTokens: frame.maxNewTokens,
		}
	}

	/**
	 * Prepare a `generate` frame with the library's own request preparation,
	 * after applying host policy: the provider-conditional system map and the
	 * user's toolToggles. Returns what the library's generate() would have
	 * computed, plus `hasTools` (whether any tool survived the toggles).
	 *
	 * @param {any} frame
	 * @param {Promise<any>|null} settingsWarm
	 */
	async function prepareFrame(frame, settingsWarm) {
		const cfg0 = await resolveCfg0(frame, settingsWarm)
		// The provider is fixed by the settings doc: sampling overrides never carry
		// one and prompt resolution doesn't change it, so cfg0.provider is what
		// callConfig will report.
		const tools = filterToolsByToggles(frame.tools, cfg0.toolToggles || {})
		const prepared = await prepareGenerate(cfg0, {
			messages: frame.text != null ? frame.text : frame.messages,
			system: resolveSystemForProvider(frame.system, cfg0.provider),
			tools,
			// A continuation is a raw string prompt with no chat messages.
			continuation: !!frame.continuation && typeof frame.messages === "undefined",
			overrides: samplingOverrides(frame),
		})
		return {...prepared, hasTools: Array.isArray(tools) && tools.length > 0}
	}

	/**
	 * Config for the non-generate ops (predict, the analytical ops, preload):
	 * resolved prompts + the flat CallConfig with sampling overrides only.
	 * @param {any} frame
	 * @param {Promise<any>|null} settingsWarm
	 */
	async function resolveForFrame(frame, settingsWarm) {
		const cfg0 = await resolveCfg0(frame, settingsWarm)
		const cfg = await resolveCfgPrompts(cfg0)
		const config = callConfig(cfg, samplingOverrides(frame))
		return {cfg, config}
	}

	/**
	 * The `toolCalls` a result frame should carry. Native function-calling
	 * providers return structured calls; for the rest (local / builtin) the model
	 * writes `<tool_call>` text, which is parsed HERE so every consumer sees the
	 * same shape and never parses model output itself. Parsing is gated on the
	 * request actually offering tools — prose that happens to contain a bare
	 * `{"name": …}` object is not a tool call. `null` when there are none.
	 *
	 * @param {string} text
	 * @param {any[]|null|undefined} toolCalls  structured calls from the worker
	 * @param {boolean} hasTools
	 * @returns {any[]|null}
	 */
	function withToolCalls(text, toolCalls, hasTools) {
		if (Array.isArray(toolCalls) && toolCalls.length) return toolCalls
		if (!hasTools) return null
		const parsed = parseToolCalls(text || "")
		return parsed.length ? parsed : null
	}

	return {
		createWorker,

		/**
		 * Warm the settings doc before any frame is handled. Returned as opaque
		 * state; the transport bounds it with a timeout and passes it to `handle`,
		 * where `resolveForFrame` awaits it. `ctx.element` reaches the
		 * `patchwork:tool-storage` provider through the DOM; without it config
		 * silently falls back to DEFAULTS (the 401 case).
		 * @param {{element?: HTMLElement}} ctx
		 */
		open(ctx) {
			return ctx.element ? Promise.resolve(ensureSettingsDoc(ctx.element)).catch(() => null) : null
		},

		/**
		 * Turn one consumer frame into worker traffic. Returns an abort token
		 * (`{sessionKey}`) so `op:"abort"` can cancel the matching worker request.
		 *
		 * `io` comes from @grjte/patchwork-worker's serveWorkerSpec:
		 *   post(msg, transfer?)  send to the worker
		 *   emit(frame)           enqueue onto this consumer's readable (id-tagged
		 *                         by the transport; we emit worker-shaped frames)
		 *   on(fn)                handle worker messages for this workerId; return
		 *                         true from fn when the request is complete
		 *   workerId              the transport-minted id to tag worker payloads
		 *   state                 whatever open() resolved (the settings warm)
		 *
		 * @param {any} frame
		 * @param {any} io
		 */
		async handle(frame, io) {
			const {post, emit, on, workerId, state: settingsWarm} = io
			const op = frame.op
			const sessionKey = frame.sessionKey || workerId

			if (op === "generate") {
				const {cfg, config, extraSystem, builtin, input, hasTools} = await prepareFrame(
					frame,
					settingsWarm
				)
				// Tell the consumer which model is answering (host-computed; no secrets).
				void modelLabel(cfg).then((label) => emit({type: "model", label}))

				// builtin (Chrome Prompt API) runs in-realm, not in the worker.
				if (builtin) {
					try {
						const full = await builtinGenerate(input, {
							temperature: config.temperature,
							topK: config.topK,
							system: effectiveSystem(cfg, extraSystem),
							onToken: (_d, f) => emit({type: "token", delta: "", text: f}),
							onStatus: (m) => emit({type: "status", message: m}),
							signal: undefined,
						})
						emit({type: "result", text: full, toolCalls: withToolCalls(full, null, hasTools)})
					} catch (e) {
						const err = /** @type {any} */ (e)
						emit({type: "error", message: err?.message || String(e)})
					}
					return {sessionKey}
				}

				on((msg) => {
					switch (msg.type) {
						case "token":
						case "prediction":
						case "stats":
							emit(msg)
							return false
						case "result":
							emit({...msg, toolCalls: withToolCalls(msg.text, msg.toolCalls, hasTools)})
							return true
						case "error":
							clog("generate: worker error", msg.message)
							emit(msg)
							return true
					}
					return false
				})
				post(buildGeneratePayload(config, input, {id: workerId, sessionKey}))
				return {sessionKey}
			}

			if (op === "predict") {
				const {cfg, config} = await resolveForFrame(frame, settingsWarm)
				config.continuation = !!frame.continuation
				if (config.provider === "builtin") {
					emit({type: "predictions", candidates: []})
					return {sessionKey}
				}
				const promptedText = applyPrompts(frame.text, cfg, frame.system)
				on((msg) => {
					if (msg.type === "predictions" || msg.type === "error") {
						emit(msg)
						return true
					}
					return false
				})
				post({type: "predict", id: workerId, sessionKey, provider: config.provider, text: promptedText, config})
				return {sessionKey}
			}

			// Analytical ops: local-only, single terminal result frame.
			/** @type {Record<string, string[]>} */
			const analytical = {
				"score-tokens": ["score-progress", "token-scores"],
				"compute-importance": ["importance-scores"],
				"compute-attention-weights": ["attention-weights"],
				"extract-features": ["features"],
				"extract-cut-features": ["cut-features"],
				"decode-tokens": ["decoded-tokens"],
				"probe-attention": ["probe-attention-result"],
			}
			if (analytical[op]) {
				const {config} = await resolveForFrame(frame, settingsWarm)
				const [progressType, terminalType] = analytical[op]
				const terminal = terminalType || progressType
				on((msg) => {
					if (msg.type === terminal) {
						emit(msg)
						return true
					}
					if (progressType && terminalType && msg.type === progressType) {
						emit(msg)
						return false
					}
					if (msg.type === "error") {
						emit(msg)
						return true
					}
					return false
				})
				/** @type {any} */
				const payload = {type: op, id: workerId, sessionKey, provider: config.provider, config}
				if (frame.text != null) payload.text = frame.text
				if (frame.ids != null) payload.ids = frame.ids
				post(payload)
				return {sessionKey}
			}

			if (op === "preload") {
				const {config} = await resolveForFrame(frame, settingsWarm)
				post({type: "preload", provider: config.provider, config})
				return {sessionKey}
			}

			// Unknown op — nothing to do.
			return {sessionKey}
		},

		/**
		 * Cancel one in-flight request. The worker keys `activeGenerations` by
		 * `sessionKey`, so that is what we post.
		 * @param {{sessionKey: string}} token
		 * @param {(m:any)=>void} post
		 */
		abort(token, post) {
			try {
				post({type: "abort", sessionKey: token.sessionKey})
			} catch {}
		},
	}
}
