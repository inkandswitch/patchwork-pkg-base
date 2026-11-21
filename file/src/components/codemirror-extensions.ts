import type {Extension} from "@codemirror/state"
import type {CompletionSource} from "@codemirror/autocomplete"
import type {FileDoc} from "../types"
import {lspLanguage} from "../lsp-language"
import {
	languageServerFiles,
	type LanguageServerFiles,
} from "../language-server-files"

// The event a tool embedding this one (in a <patchwork-view tool-id="file">)
// listens for to add its own CodeMirror extensions. Both the editor and the
// read-only viewer dispatch it once, just before they create their view, and
// it bubbles out of the patchwork-view; a listener pushes onto
// `detail.extensions`. Extensions have to come from the shared @codemirror/*
// modules in the import map, like these editors'. `readOnly` says which one
// asked.
//
// For a code file in the editor (the ones that get the TypeScript language
// server) it also has `languageServer`, to give the server files of its own
// (say, ones the code imports), and `completionSources`, to push completion
// sources onto: they join the language's and the server's completions, and
// the server's options with a label one of them already gave at the same
// place are left out. Other files don't have them.
export const CODEMIRROR_EXTENSIONS_EVENT = "file:codemirror-extensions"

export type CodemirrorExtensionsDetail = {
	handle: any
	doc: FileDoc
	readOnly: boolean
	extensions: Extension[]
	languageServer?: LanguageServerFiles
	completionSources?: CompletionSource[]
}

export function collectExtensions(
	element: HTMLElement | undefined,
	handle: any,
	doc: FileDoc,
	readOnly: boolean,
): CodemirrorExtensionsDetail {
	const code = !readOnly && !!lspLanguage(doc?.extension)
	const detail: CodemirrorExtensionsDetail = {
		handle,
		doc,
		readOnly,
		extensions: [],
		...(code && {
			languageServer: languageServerFiles,
			completionSources: [],
		}),
	}
	element?.dispatchEvent(
		new CustomEvent(CODEMIRROR_EXTENSIONS_EVENT, {
			detail,
			bubbles: true,
			composed: true,
		}),
	)
	return detail
}
