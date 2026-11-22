import {onCleanup} from "solid-js"
import {
	EditorView,
	lineNumbers,
	highlightSpecialChars,
	highlightActiveLineGutter,
	highlightActiveLine,
	rectangularSelection,
	keymap,
	scrollPastEnd,
} from "@codemirror/view"
import {EditorState, Compartment} from "@codemirror/state"
import {
	indentUnit,
	bracketMatching,
	foldGutter,
	foldKeymap,
} from "@codemirror/language"
import {
	highlightSelectionMatches,
	searchKeymap,
} from "@codemirror/search"
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
	emacsStyleKeymap,
} from "@codemirror/commands"
import {automergeSyncPlugin} from "@automerge/automerge-codemirror"
import {isImmutableStringFileDoc} from "../datatype"
import {createCaretExtension} from "./caret"
import {collectExtensions} from "./codemirror-extensions"
import {tooltipLayer} from "./tooltip-layer"
import {createFileComments} from "./comments"
import {createPresenceExtension} from "./presence"
import {mod, modshift, zoomKeydown} from "./zoom"
import {subscribe} from "@inkandswitch/patchwork-providers-solid"
import type {AutomergeUrl, Repo} from "@automerge/automerge-repo/slim"
import codemirrorTheme from "../codemirror-theme"
import {getLanguageExtension} from "../languages"
import {lspLanguage} from "../lsp-language"
import type {FileDoc} from "../types"

// A file is treated as text whenever its content actually is text — a plain
// string (editable) or an ImmutableString (read-only). We key off the content
// shape rather than the declared mimeType, which is frequently missing or
// generic (e.g. application/octet-stream) for files that are perfectly editable
// text.
export const isTextFile = (doc: FileDoc) => {
	return typeof doc?.content === "string" || (!!doc && isImmutableStringFileDoc(doc))
}

export function TextFileEditor(props: {
	doc: FileDoc
	handle: any
	element?: HTMLElement
}) {
	let container!: HTMLDivElement

	const languageExtension = getLanguageExtension(
		props.doc.extension,
		props.doc.mimeType,
	)

	// The language server's features are reconfigured into this compartment
	// once its client has loaded — see below.
	const tsCompartment = new Compartment()

	const comments =
		props.handle && props.element
			? createFileComments({handle: props.handle, element: props.element})
			: undefined

	// Other people's carets and selections, coloured by their account. Needs
	// to know who we are (to identify ourselves) and the repo (to read each
	// peer's contact doc for their colour); with either missing it shows none.
	const contactUrl = props.element
		? subscribe<AutomergeUrl>(props.element, {type: "patchwork:contact"})
		: () => undefined
	const repo = (props.element as (HTMLElement & {repo?: Repo}) | undefined)
		?.repo
	const [presenceExtension, reconfigurePresence] = createPresenceExtension(
		() => props.handle,
		() => ["content"],
		() => (props.handle && repo ? (contactUrl() ?? null) : null),
		repo as Repo,
	)

	// what a tool embedding this one adds: extensions (last in the editor, so
	// they can override anything above them) and, for code files, completion
	// sources for the language server's completion below
	const embedder = collectExtensions(props.element, props.handle, props.doc, false)

	const view = new EditorView({
		doc: props.doc.content?.toString() || "",
		extensions: [
			lineNumbers(),
			highlightSpecialChars(),
			highlightActiveLineGutter(),
			highlightActiveLine(),
			highlightSelectionMatches(),
			history(),
			foldGutter(),
			bracketMatching(),
			indentUnit.of("\t"),
			EditorState.allowMultipleSelections.of(true),
			EditorState.tabSize.of(2),
			EditorView.lineWrapping,
			scrollPastEnd(),
			EditorView.clickAddsSelectionRange.of((event) => {
				const mask = modshift(event)
				if (mask == 1 << mod.option) return true
				return false
			}),
			rectangularSelection({
				eventFilter(event) {
					const mask = modshift(event)
					if (mask == ((1 << mod.shift) | (1 << mod.option)))
						return true
					return false
				},
			}),
			keymap.of([
				indentWithTab,
				...emacsStyleKeymap,
				...searchKeymap,
				...historyKeymap,
				...foldKeymap,
				...defaultKeymap,
			]),
			languageExtension,
			tooltipLayer(),
			tsCompartment.of([]),
			...codemirrorTheme,
			automergeSyncPlugin({handle: props.handle, path: ["content"]}),
			presenceExtension,
			createCaretExtension(),
			comments?.extension ?? [],
			embedder.extensions,
		],
	})
	comments?.attach(view)
	reconfigurePresence(view)

	// For code files, connect to the shared TypeScript language server (tsgo,
	// in a worker) and add its features to the editor in place. Each document
	// is its own folder in the server's filesystem, so open files never clash.
	// It's loaded on demand, so only code files pay for it.
	const languageId = lspLanguage(props.doc.extension)
	if (languageId) {
		let disposed = false
		onCleanup(() => {
			disposed = true
		})
		const ext = props.doc.extension.replace(/^\./, "").toLowerCase()
		const uri = `file:///${props.handle?.documentId ?? "untitled"}/index.${ext}`
		void import("../typescript-language-server")
			.then(({typescriptLanguageServer, completion}) => {
				if (disposed) return
				view.dispatch({
					effects: tsCompartment.reconfigure([
						typescriptLanguageServer().plugin(uri, languageId),
						completion(embedder.completionSources),
					]),
				})
			})
			.catch((error) => {
				// type hints are an extra: without them it's a plain editor
				console.error("failed to start TypeScript language server", error)
			})
	}

	onCleanup(() => {
		view.destroy()
	})

	const zoom = zoomKeydown(view)

	return (
		<div
			onKeyDown={zoom}
			ref={(el) => {
				container = el
				el.appendChild(view.dom)
			}}
			style={{
				width: "100%",
				height: "100%",
			}}
		/>
	)
}
