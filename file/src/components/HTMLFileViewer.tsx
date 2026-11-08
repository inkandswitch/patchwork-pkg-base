import {createMemo, createSignal, Show} from "solid-js"
import type {FileDoc} from "../types"
import {fileText} from "../datatype"
import {createObjectUrl} from "./object-url"

export type HTMLFileDoc = FileDoc & {
	extension: "html" | "htm"
}

export const isHTMLFile = (doc: FileDoc) => {
	return (
		["html", "htm"].includes(doc.extension?.toLowerCase()) ||
		doc.mimeType === "text/html"
	)
}

// What a shared page may do by default. Scripts, forms, popups and modals are
// what ordinary pages need. allow-same-origin is deliberately absent: without
// it the page gets an opaque origin, so it can't reach the app's repo, storage
// or cookies. (A blob: URL otherwise inherits the app's origin.)
export const HTML_SANDBOX = "allow-scripts allow-forms allow-popups allow-modals"

export function HTMLFileViewer(props: {doc: FileDoc}) {
	// Local to this view on purpose: never stored in the document, or a peer
	// could switch off your sandbox. Resets when the view remounts.
	const [appAccess, setAppAccess] = createSignal(false)

	// fileText handles every content shape: string, bytes, ImmutableString, and
	// the {val} an ImmutableString becomes in a cloned/projected doc.
	const textData = createMemo(() => fileText(props.doc))

	const blobUrl = createObjectUrl(() => {
		const content = textData()
		if (!content) return undefined
		return new Blob([content], {type: "text/html"})
	})

	return (
		<div
			data-sandbox={appAccess() ? "off" : "on"}
			style={{display: "flex", "flex-direction": "column", height: "100%"}}>
			<div
				style={{
					display: "flex",
					"align-items": "baseline",
					gap: "0.75em",
					padding: "0.2em 0.6em",
					"font-size": "0.8em",
					color: "var(--editor-line)",
				}}>
				<span>
					{appAccess()
						? "Running with app access: this page can read and change your documents."
						: "Running in a sandbox, without access to your documents."}
				</span>
				<button
					type="button"
					onClick={() => setAppAccess(!appAccess())}
					style={{
						font: "inherit",
						background: "none",
						border: "none",
						padding: 0,
						color: "inherit",
						"text-decoration": "underline",
						cursor: "pointer",
					}}>
					{appAccess() ? "Sandbox it again" : "Run with app access"}
				</button>
			</div>
			<div style={{overflow: "auto", flex: 1, "min-height": 0}}>
				<Show
					when={textData() && blobUrl()}
					fallback={
						<div
							style={{
								display: "flex",
								"align-items": "center",
								"justify-content": "center",
								height: "100%",
								background: "var(--editor-fill)",
								color: "var(--editor-line)",
							}}>
							Loading...
						</div>
					}>
					{/* keyed on the sandbox state: changing the attribute on a live
					    iframe wouldn't reload it, a fresh element does */}
					<Show when={appAccess() ? "off" : "on"} keyed>
						{(mode) => (
							<iframe
								src={blobUrl()}
								sandbox={mode === "on" ? HTML_SANDBOX : undefined}
								style={{width: "100%", height: "100%", border: "none"}}
							/>
						)}
					</Show>
				</Show>
			</div>
		</div>
	)
}
