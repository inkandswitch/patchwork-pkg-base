// One TypeScript language server (tsgo, in a worker) shared by every JS/TS
// editor on the page, started the first time a code file is opened. Its wasm
// is ~49MB, so the first answers can take a while; the client waits.
import {EditorState, type Extension, type Text} from "@codemirror/state"
import {EditorView, keymap} from "@codemirror/view"
import {
	autocompletion,
	type CompletionContext,
	type CompletionResult,
	type CompletionSource,
} from "@codemirror/autocomplete"
import {
	LSPClient,
	LSPPlugin,
	Workspace,
	findReferencesKeymap,
	formatKeymap,
	hoverTooltips,
	renameKeymap,
	serverCompletion,
	serverCompletionSource,
	serverDiagnostics,
	signatureHelp,
	type Transport,
	type WorkspaceFile,
} from "@codemirror/lsp-client"
import {languageServerFiles} from "./language-server-files"

// Dispatched (bubbling, composed) from the editor that asked, when go to
// definition lands in a file no editor on the page has open, so a tool
// embedding this one can open it. `line` and `character` are LSP's, from 0.
export const OPEN_DEFINITION_EVENT = "file:open-definition"

export type OpenDefinitionDetail = {
	uri: string
	line: number
	character: number
}

type Position = {line: number; character: number}

// where a definition was asked for, and where it is
type DefinitionFrom = {view: EditorView; position: Position}

class PageFile implements WorkspaceFile {
	constructor(
		readonly uri: string,
		readonly languageId: string,
		public version: number,
		public doc: Text,
		readonly view: EditorView,
	) {}
	getView() {
		return this.view
	}
}

// lsp-client's default workspace (one editor per file, only files that have
// one), except that a definition in a file nobody has open is passed on as
// OPEN_DEFINITION_EVENT instead of going nowhere. One client serves every
// editor, so goToDefinition says which one asked.
class PageWorkspace extends Workspace {
	files: PageFile[] = []
	private versions: Record<string, number> = Object.create(null)

	private nextVersion(uri: string) {
		return (this.versions[uri] = (this.versions[uri] ?? -1) + 1)
	}

	syncFiles() {
		const updates: ReturnType<Workspace["syncFiles"]>[number][] = []
		for (const file of this.files) {
			const plugin = LSPPlugin.get(file.view)
			if (!plugin) continue
			const changes = plugin.unsyncedChanges
			if (changes.empty) continue
			updates.push({changes, file, prevDoc: file.doc})
			file.doc = file.view.state.doc
			file.version = this.nextVersion(file.uri)
			plugin.clear()
		}
		return updates
	}

	openFile(uri: string, languageId: string, view: EditorView) {
		if (this.getFile(uri)) {
			throw new Error(
				"Default workspace implementation doesn't support multiple views on the same file",
			)
		}
		const file = new PageFile(
			uri,
			languageId,
			this.nextVersion(uri),
			view.state.doc,
			view,
		)
		this.files.push(file)
		this.client.didOpen(file)
	}

	closeFile(uri: string) {
		const file = this.getFile(uri)
		if (!file) return
		this.files = this.files.filter((f) => f != file)
		this.client.didClose(uri)
	}

	displayFile(uri: string, from?: DefinitionFrom): Promise<EditorView | null> {
		const view = this.getFile(uri)?.getView() ?? null
		if (!view && from) {
			const detail: OpenDefinitionDetail = {
				uri,
				line: from.position.line,
				character: from.position.character,
			}
			from.view.dom.dispatchEvent(
				new CustomEvent(OPEN_DEFINITION_EVENT, {
					detail,
					bubbles: true,
					composed: true,
				}),
			)
		}
		return Promise.resolve(view)
	}
}

type Location = {uri: string; range: {start: Position}}
type LocationLink = {targetUri: string; targetSelectionRange: {start: Position}}

function destination(
	response: Location | LocationLink | (Location | LocationLink)[] | null,
) {
	const first = Array.isArray(response) ? response[0] : response
	if (!first) return null
	return "targetUri" in first
		? {uri: first.targetUri, position: first.targetSelectionRange.start}
		: {uri: first.uri, position: first.range.start}
}

// lsp-client's jumpToDefinition, from any position (not just the cursor), and
// telling the workspace which editor asked
export function goToDefinition(
	view: EditorView,
	pos = view.state.selection.main.head,
): boolean {
	const plugin = LSPPlugin.get(view)
	if (!plugin) return false
	const {client} = plugin
	if (client.serverCapabilities && !client.serverCapabilities.definitionProvider) {
		return false
	}
	client.sync()
	client.withMapping((mapping) =>
		client
			.request<unknown, Parameters<typeof destination>[0]>(
				"textDocument/definition",
				{
					textDocument: {uri: plugin.uri},
					position: plugin.toPosition(pos),
				},
			)
			.then(async (response) => {
				const to = destination(response)
				if (!to) return
				const {workspace} = client
				const target =
					to.uri == plugin.uri
						? view
						: workspace instanceof PageWorkspace
							? await workspace.displayFile(to.uri, {view, position: to.position})
							: await workspace.displayFile(to.uri)
				if (!target) return
				const anchor = mapping.getMapping(to.uri)
					? mapping.mapPosition(to.uri, to.position)
					: plugin.fromPosition(to.position, target.state.doc)
				target.dispatch({
					selection: {anchor},
					scrollIntoView: true,
					userEvent: "select.definition",
				})
			})
			.catch((error) => plugin.reportError("Find definition failed", error)),
	)
	return true
}

const apple =
	typeof navigator != "undefined" &&
	["Mac", "iPhone", "iPad"].some((name) => navigator.platform.includes(name))

// mod+click (cmd on a Mac, ctrl elsewhere) goes to the definition of what was
// clicked. At default precedence, so an embedder's Prec.high mousedown that
// returns true has it first.
const definitionClick = EditorView.domEventHandlers({
	mousedown(event, view) {
		if (event.button != 0 || event.altKey || event.shiftKey) return false
		if (apple ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) {
			return false
		}
		const pos = view.posAtCoords({x: event.clientX, y: event.clientY})
		if (pos == null || !goToDefinition(view, pos)) return false
		event.preventDefault()
		return true
	},
})

// languageServerExtensions(), but with completion left to each editor (see
// completion()) and go to definition our own
const extensions = [
	hoverTooltips(),
	keymap.of([
		...formatKeymap,
		...renameKeymap,
		{key: "F12", run: (view) => goToDefinition(view), preventDefault: true},
		...findReferencesKeymap,
	]),
	signatureHelp(),
	serverDiagnostics(),
	definitionClick,
]

// The server's completion source, with the options left out whose label one of
// `sources` already gave at the same place, after `sources` themselves. Each
// of them is asked once per completion, whichever wants its answer first.
export function withoutDuplicates(
	sources: readonly CompletionSource[],
	server: CompletionSource = serverCompletionSource,
): CompletionSource[] {
	type Answer = Promise<CompletionResult | null>
	const asked = new WeakMap<EditorState, Map<string, Answer>>()
	const ask = (i: number, context: CompletionContext): Answer => {
		let answers = asked.get(context.state)
		if (!answers) asked.set(context.state, (answers = new Map()))
		const key = `${i}:${context.pos}:${context.explicit}`
		let answer = answers.get(key)
		if (!answer) {
			answer = new Promise((resolve) => resolve(sources[i](context)))
			answers.set(key, answer)
		}
		return answer
	}
	const theirs: CompletionSource = async (context) => {
		const [result, ours] = await Promise.all([
			server(context),
			// a source that failed has its own say; it just doesn't take any of these
			Promise.all(sources.map((_, i) => ask(i, context).catch(() => null))),
		])
		if (!result) return result
		const given = new Set<string>()
		for (const answer of ours) {
			if (answer?.from != result.from) continue
			for (const option of answer.options) given.add(option.label)
		}
		if (!given.size) return result
		return {...result, options: result.options.filter((o) => !given.has(o.label))}
	}
	return [...sources.map((_, i) => (context: CompletionContext) => ask(i, context)), theirs]
}

// Completion for one editor: the server's, as lsp-client does it (a
// language-data source, beside the language's own keywords, snippets and
// local names). Sources the embedder pushed onto `detail.completionSources`
// join them there, and the only change is that the server leaves out what
// they already gave.
export function completion(sources: readonly CompletionSource[] = []): Extension {
	if (!sources.length) return serverCompletion()
	const data = withoutDuplicates(sources).map((autocomplete) => ({autocomplete}))
	return [autocompletion(), EditorState.languageData.of(() => data)]
}

export function createLanguageClient(transport: Transport): LSPClient {
	return new LSPClient({
		rootUri: "file:///",
		timeout: 30_000,
		workspace: (client) => new PageWorkspace(client),
		extensions,
	}).connect(transport)
}

let client: LSPClient | undefined

// tsgo.wasm is written out next to this module by the build (vite.config.ts).
// it's named through a variable so vite doesn't try to bundle it (it rewrites
// new URL() with a literal or template literal)
const WASM = "tsgo.wasm"

export function typescriptLanguageServer(): LSPClient {
	if (client) return client
	const worker = new Worker(new URL("./tsgo-worker.ts", import.meta.url), {
		type: "module",
	})
	worker.postMessage({wasm: new URL(WASM, import.meta.url).href})
	// the files embedders have given it so far, and from now on
	languageServerFiles.connect((change) => worker.postMessage(change))
	const handlers = new Set<(message: string) => void>()
	worker.onmessage = (event) => {
		if (typeof event.data?.lsp === "string") {
			for (const handler of handlers) handler(event.data.lsp)
		} else if (event.data?.failed) {
			// type hints are an extra: without them it's a plain editor
			console.error("TypeScript language server didn't start:", event.data.failed)
		}
	}
	worker.onerror = (event) => {
		console.error("TypeScript language server worker:", event.message)
	}
	const transport: Transport = {
		send: (message) => worker.postMessage({lsp: message}),
		subscribe: (handler) => handlers.add(handler),
		unsubscribe: (handler) => handlers.delete(handler),
	}
	client = createLanguageClient(transport)
	return client
}
