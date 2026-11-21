import {describe, expect, it, vi} from "vitest"
import {EditorState, Prec, type Extension} from "@codemirror/state"
import {EditorView} from "@codemirror/view"
import {
	CompletionContext,
	type CompletionResult,
	type CompletionSource,
} from "@codemirror/autocomplete"
import type {Transport} from "@codemirror/lsp-client"
import {
	OPEN_DEFINITION_EVENT,
	createLanguageClient,
	goToDefinition,
	completion,
	withoutDuplicates,
} from "./typescript-language-server"
import {javascript} from "@codemirror/lang-javascript"

// a language server that says it can do definitions, and answers every
// definition request with `definition`
function fakeServer(definition: unknown) {
	const handlers = new Set<(message: string) => void>()
	const sent: any[] = []
	const reply = (id: number, result: unknown) =>
		queueMicrotask(() => {
			for (const handler of handlers) {
				handler(JSON.stringify({jsonrpc: "2.0", id, result}))
			}
		})
	const transport: Transport = {
		send(message) {
			const value = JSON.parse(message)
			sent.push(value)
			if (value.method == "initialize") {
				reply(value.id, {capabilities: {definitionProvider: true}})
			} else if (value.method == "textDocument/definition") {
				reply(value.id, definition)
			}
		},
		subscribe: (handler) => handlers.add(handler),
		unsubscribe: (handler) => handlers.delete(handler),
	}
	return {transport, sent}
}

function until<T>(fn: () => T | undefined): Promise<T> {
	return new Promise((resolve, reject) => {
		const started = Date.now()
		const poll = () => {
			const value = fn()
			if (value !== undefined) return resolve(value)
			if (Date.now() - started > 2000) return reject(new Error("timed out"))
			setTimeout(poll, 5)
		}
		poll()
	})
}

function result(from: number, ...labels: string[]): CompletionResult {
	return {from, options: labels.map((label) => ({label}))}
}

async function complete(sources: CompletionSource[], doc: string) {
	const state = EditorState.create({doc})
	return Promise.all(
		sources.map((source) =>
			source(new CompletionContext(state, doc.length, true)),
		),
	)
}

describe("completion with an embedder's sources", () => {
	it("puts the embedder's sources first and drops the server's options they already gave", async () => {
		const ours: CompletionSource = () => result(4, "width", "rows")
		const server: CompletionSource = () => result(4, "width", "toString")
		const answers = await complete(withoutDuplicates([ours], server), "doc.w")
		expect(answers[0]?.options.map((o) => o.label)).toEqual(["width", "rows"])
		expect(answers[1]?.options.map((o) => o.label)).toEqual(["toString"])
	})

	it("keeps the server's option when the embedder's is at another place", async () => {
		const ours: CompletionSource = () => result(0, "width")
		const server: CompletionSource = () => result(4, "width")
		const answers = await complete(withoutDuplicates([ours], server), "doc.w")
		expect(answers[1]?.options.map((o) => o.label)).toEqual(["width"])
	})

	it("asks each embedder source once per completion", async () => {
		const ours = vi.fn<CompletionSource>(async () => result(4, "width"))
		const server: CompletionSource = () => result(4, "width")
		await complete(withoutDuplicates([ours], server), "doc.w")
		expect(ours).toHaveBeenCalledTimes(1)
	})

	it("doesn't wait long on an embedder source that hasn't answered", async () => {
		const never: CompletionSource = () => new Promise(() => {})
		const server: CompletionSource = () => result(4, "width", "toString")
		const [, theirs] = withoutDuplicates([never], server, 20)
		const state = EditorState.create({doc: "doc.w"})
		const answer = await theirs(new CompletionContext(state, 5, true))
		expect(answer?.options.map((o) => o.label)).toEqual(["width", "toString"])
	})

	it("passes on a server with nothing to say", async () => {
		const ours: CompletionSource = () => null
		const server: CompletionSource = () => null
		expect(await complete(withoutDuplicates([ours], server), "x")).toEqual([
			null,
			null,
		])
	})
})

describe("an editor's completion with an embedder's sources", () => {
	// everything the editor would ask, as autocompletion() does without an override
	async function labels(extensions: Extension, doc: string) {
		const state = EditorState.create({doc, extensions})
		const sources = state.languageDataAt<CompletionSource>("autocomplete", doc.length)
		const results = await Promise.all(
			sources.map((source) => source(new CompletionContext(state, doc.length, true))),
		)
		return results.flatMap((r) => r?.options.map((o) => o.label) ?? [])
	}

	it("keeps the language's own completions beside the embedder's", async () => {
		const ours: CompletionSource = (context) => ({
			from: context.pos - 3,
			options: [{label: "retina"}],
		})
		const got = await labels([javascript(), completion([ours])], "let a = 1\nret")
		expect(got).toContain("retina")
		expect(got).toContain("return")
	})

	it("is the language's own completions alone when the embedder pushed nothing", async () => {
		const got = await labels([javascript(), completion([])], "ret")
		expect(got).toContain("return")
	})
})

describe("go to definition", () => {
	const elsewhere = {
		uri: "file:///other/index.js",
		range: {start: {line: 2, character: 4}, end: {line: 2, character: 9}},
	}

	function editor(
		transport: Transport,
		uri = "file:///mine/index.js",
		extensions: Extension = [],
	) {
		const client = createLanguageClient(transport)
		const parent = document.createElement("div")
		document.body.append(parent)
		const view = new EditorView({
			doc: "import {x} from 'automerge:other'\nx()\n",
			parent,
			extensions: [client.plugin(uri, "javascript"), extensions],
		})
		return {client, view, parent}
	}

	function heard(target: EventTarget) {
		const events: Array<{event: CustomEvent; target: EventTarget | null}> = []
		target.addEventListener(OPEN_DEFINITION_EVENT, (event) =>
			events.push({event: event as CustomEvent, target: event.target}),
		)
		return events
	}

	it("tells the asking editor when a definition is in a file no editor has open", async () => {
		const {transport} = fakeServer(null)
		const {client, view, parent} = editor(transport)
		const events = heard(parent)
		const shown = await (client.workspace as any).displayFile(elsewhere.uri, {
			view,
			position: elsewhere.range.start,
		})
		expect(shown).toBe(null)
		expect(events).toHaveLength(1)
		expect(events[0].target).toBe(view.dom)
		expect(events[0].event.bubbles).toBe(true)
		expect(events[0].event.composed).toBe(true)
		expect(events[0].event.detail).toEqual({
			uri: "file:///other/index.js",
			line: 2,
			character: 4,
		})
		view.destroy()
	})

	it("shows a file another editor has open instead", async () => {
		const {transport} = fakeServer(null)
		const {client, view, parent} = editor(transport)
		const other = new EditorView({
			doc: "",
			extensions: [client.plugin(elsewhere.uri, "javascript")],
		})
		const events = heard(parent)
		const shown = await (client.workspace as any).displayFile(elsewhere.uri, {
			view,
			position: elsewhere.range.start,
		})
		expect(shown).toBe(other)
		expect(events).toHaveLength(0)
		other.destroy()
		view.destroy()
	})

	it("asks the server, then sends the editor that asked off to an unopened file", async () => {
		const {transport, sent} = fakeServer([elsewhere])
		const {client, view, parent} = editor(transport)
		await client.initializing
		const events = heard(parent)
		expect(goToDefinition(view, 36)).toBe(true)
		const {event} = await until(() => events[0])
		expect(event.detail).toEqual({
			uri: "file:///other/index.js",
			line: 2,
			character: 4,
		})
		const request = sent.find((m) => m.method == "textDocument/definition")
		expect(request.params).toEqual({
			textDocument: {uri: "file:///mine/index.js"},
			position: {line: 1, character: 2},
		})
		view.destroy()
	})

	it("follows a LocationLink too", async () => {
		const {transport} = fakeServer([
			{
				targetUri: elsewhere.uri,
				targetRange: elsewhere.range,
				targetSelectionRange: {
					start: {line: 3, character: 1},
					end: {line: 3, character: 2},
				},
			},
		])
		const {client, view, parent} = editor(transport)
		await client.initializing
		const events = heard(parent)
		goToDefinition(view, 36)
		const {event} = await until(() => events[0])
		expect(event.detail).toEqual({uri: elsewhere.uri, line: 3, character: 1})
		view.destroy()
	})

	it("moves the cursor when the definition is in this file", async () => {
		const {transport} = fakeServer({
			uri: "file:///mine/index.js",
			range: {start: {line: 0, character: 8}, end: {line: 0, character: 9}},
		})
		const {client, view} = editor(transport)
		await client.initializing
		goToDefinition(view, 36)
		await until(() => (view.state.selection.main.head == 8 ? true : undefined))
		view.destroy()
	})

	it("runs on mod+click, where it was clicked", async () => {
		const {transport, sent} = fakeServer([elsewhere])
		const {client, view, parent} = editor(transport)
		await client.initializing
		const events = heard(parent)
		view.posAtCoords = (() => 35) as any
		const apple = ["Mac", "iPhone", "iPad"].some((name) =>
			navigator.platform.includes(name),
		)
		view.contentDOM.dispatchEvent(
			new MouseEvent("mousedown", {
				bubbles: true,
				cancelable: true,
				button: 0,
				metaKey: apple,
				ctrlKey: !apple,
			}),
		)
		await until(() => events[0])
		const request = sent.find((m) => m.method == "textDocument/definition")
		expect(request.params.position).toEqual({line: 1, character: 1})
		view.destroy()
	})

	it("leaves a plain click alone", async () => {
		const {transport, sent} = fakeServer([elsewhere])
		// (and keeps it from codemirror's own selecting, which needs layout)
		let passedOn = 0
		const after = Prec.lowest(
			EditorView.domEventHandlers({mousedown: () => (passedOn++, true)}),
		)
		const {client, view} = editor(transport, undefined, after)
		await client.initializing
		view.posAtCoords = (() => 35) as any
		view.contentDOM.dispatchEvent(
			new MouseEvent("mousedown", {bubbles: true, cancelable: true, button: 0}),
		)
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(passedOn).toBe(1)
		expect(sent.some((m) => m.method == "textDocument/definition")).toBe(false)
		view.destroy()
	})

	it("lets an embedder's Prec.high mousedown have the click first", async () => {
		const {transport, sent} = fakeServer([elsewhere])
		let theirs = 0
		const embedder = Prec.high(
			EditorView.domEventHandlers({mousedown: () => (theirs++, true)}),
		)
		const {client, view} = editor(transport, undefined, embedder)
		await client.initializing
		view.posAtCoords = (() => 35) as any
		const apple = ["Mac", "iPhone", "iPad"].some((name) =>
			navigator.platform.includes(name),
		)
		view.contentDOM.dispatchEvent(
			new MouseEvent("mousedown", {
				bubbles: true,
				cancelable: true,
				button: 0,
				metaKey: apple,
				ctrlKey: !apple,
			}),
		)
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(theirs).toBe(1)
		expect(sent.some((m) => m.method == "textDocument/definition")).toBe(false)
		view.destroy()
	})
})
