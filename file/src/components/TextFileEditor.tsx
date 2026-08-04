import {isImmutableString} from "@automerge/automerge-repo/slim"
import type {FileDoc} from "../types"
import {pluginsAttribute} from "../plugins"

// A file is treated as text whenever its content actually is text — a plain
// string (editable) or an ImmutableString (read-only). We key off the content
// shape rather than the declared mimeType, which is frequently missing or
// generic (e.g. application/octet-stream) for files that are perfectly editable
// text.
export const isTextFile = (doc: FileDoc) => {
	return typeof doc?.content === "string" || isImmutableString(doc?.content)
}

// The editor itself lives in the text-editor package; this is the shell that
// tells it which plugins a file of this name wants, unless the file names its
// own. Everything that used to be hand-assembled here — the keymaps, the
// gutters, the language grammars, the TypeScript environment — is now a
// `codemirror:extension` those ids name.
export function TextFileEditor(props: {doc: FileDoc; handle: any}) {
	return (
		<patchwork-view
			component="text-editor"
			doc-url={props.handle.url}
			plugins={pluginsAttribute(props.doc)}
			style={{width: "100%", height: "100%"}}
		/>
	)
}
