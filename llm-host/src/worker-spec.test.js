import {describe, it, expect, vi, beforeEach} from "vitest"
import {makeLLMWorkerSpec} from "./worker-spec.js"

/**
 * A fake @chee/patchwork-llm: just enough for the spec's host policy to be
 * observable. `prepareGenerate` echoes what it was given so the test can assert
 * on the overrides / system / tools the spec chose to forward.
 */
function fakeLib(cfg = {provider: "local", toolToggles: {}}) {
	const lib = {
		createWorker: () => ({}),
		ensureConfig: vi.fn(async () => cfg),
		ensureSettingsDoc: vi.fn(async () => ({})),
		settingsDocHandle: () => ({}),
		callConfig: (c, o) => ({provider: c.provider, ...o}),
		applyPrompts: (input) => input,
		effectiveSystem: () => "",
		describeConfig: () => "Model",
		fetchOpenRouterModels: async () => [],
		builtinGenerate: vi.fn(async () => "built-in text"),
		resolveCfgPrompts: async (c) => c,
		prepareGenerate: vi.fn(async (cfg0, opts) => ({
			cfg: cfg0,
			config: {provider: cfg0.provider, ...opts.overrides},
			extraSystem: opts.system,
			builtin: cfg0.provider === "builtin",
			input: opts.messages,
		})),
		buildGeneratePayload: (config, input, ids) => ({type: "generate", ...ids, provider: config.provider, config, messages: input}),
		parseToolCalls: vi.fn((text) => (text.includes("<tool_call>") ? [{name: "x", args: {}}] : [])),
	}
	return lib
}

function fakeIO() {
	/** @type {any} */
	const io = {
		post: vi.fn(),
		emit: vi.fn(),
		handler: null,
		on: (fn) => {
			io.handler = fn
		},
		workerId: "w1",
		state: null,
	}
	return io
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("makeLLMWorkerSpec · generate", () => {
	let lib, spec, io
	beforeEach(() => {
		lib = fakeLib()
		spec = makeLLMWorkerSpec(lib)
		io = fakeIO()
	})

	it("parses <tool_call> text host-side when the request offered tools", async () => {
		await spec.handle({op: "generate", messages: [{role: "user", content: "hi"}], tools: [{name: "x"}]}, io)
		io.handler({type: "result", text: "<tool_call>{}</tool_call>", toolCalls: null, toolMode: "template"})
		const result = io.emit.mock.calls.map((c) => c[0]).find((f) => f.type === "result")
		expect(result.toolCalls).toEqual([{name: "x", args: {}}])
		expect(result.toolMode).toBe("template")
		expect(lib.parseToolCalls).toHaveBeenCalledOnce()
	})

	it("passes native toolCalls through untouched", async () => {
		await spec.handle({op: "generate", messages: [], tools: [{name: "x"}]}, io)
		const native = [{name: "x", args: {a: 1}}]
		io.handler({type: "result", text: "", toolCalls: native})
		const result = io.emit.mock.calls.map((c) => c[0]).find((f) => f.type === "result")
		expect(result.toolCalls).toBe(native)
		expect(lib.parseToolCalls).not.toHaveBeenCalled()
	})

	it("does not parse prose when no tools were offered", async () => {
		await spec.handle({op: "generate", messages: []}, io)
		io.handler({type: "result", text: '<tool_call>{"name":"x"}</tool_call>', toolCalls: null})
		const result = io.emit.mock.calls.map((c) => c[0]).find((f) => f.type === "result")
		expect(result.toolCalls).toBeNull()
		expect(lib.parseToolCalls).not.toHaveBeenCalled()
	})

	it("forwards only sampling overrides, never provider / apiKey / model / url", async () => {
		await spec.handle(
			{
				op: "generate",
				messages: [],
				temperature: 0.2,
				topP: 0.9,
				provider: "openrouter",
				apiKey: "sk-evil",
				model: "gpt",
				url: "https://attacker",
				config: {apiKey: "sk-evil"},
			},
			io
		)
		const [, opts] = lib.prepareGenerate.mock.calls[0]
		expect(opts.overrides).toEqual({temperature: 0.2, topP: 0.9, topk: undefined, maxNewTokens: undefined})
		expect(Object.keys(opts.overrides)).not.toContain("provider")
		expect(Object.keys(opts.overrides)).not.toContain("apiKey")
	})

	it("applies the provider-conditional system map and toolToggles before preparing", async () => {
		lib = fakeLib({provider: "local", toolToggles: {off: false, optin: true}})
		spec = makeLLMWorkerSpec(lib)
		await spec.handle(
			{
				op: "generate",
				messages: [],
				system: {default: "d", local: "L"},
				tools: [{name: "on"}, {name: "off"}, {name: "optin", defaultOff: true}, {name: "hidden", defaultOff: true}],
			},
			io
		)
		const [, opts] = lib.prepareGenerate.mock.calls[0]
		expect(opts.system).toBe("L")
		expect(opts.tools.map((t) => t.name)).toEqual(["on", "optin"])
	})

	it("posts the library-built payload tagged with the transport's workerId", async () => {
		const token = await spec.handle({op: "generate", messages: [{role: "user", content: "hi"}], sessionKey: "s1"}, io)
		expect(token).toEqual({sessionKey: "s1"})
		expect(io.post).toHaveBeenCalledWith(
			expect.objectContaining({type: "generate", id: "w1", sessionKey: "s1", messages: [{role: "user", content: "hi"}]})
		)
	})

	it("runs builtin in-realm and still fills toolCalls", async () => {
		lib = fakeLib({provider: "builtin", toolToggles: {}})
		lib.builtinGenerate = vi.fn(async () => "<tool_call>{}</tool_call>")
		spec = makeLLMWorkerSpec(lib)
		await spec.handle({op: "generate", messages: [], tools: [{name: "x"}]}, io)
		await flush()
		expect(io.post).not.toHaveBeenCalled()
		const result = io.emit.mock.calls.map((c) => c[0]).find((f) => f.type === "result")
		expect(result.text).toBe("<tool_call>{}</tool_call>")
		expect(result.toolCalls).toEqual([{name: "x", args: {}}])
	})
})
