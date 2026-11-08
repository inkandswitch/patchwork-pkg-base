import {Show, Match, Switch, createMemo, createSignal, onCleanup} from "solid-js"
import {useDocHandle, createDocumentProjection} from "solid-automerge"
import type {FileDoc} from "../types"
import {HTMLFileViewer} from "./HTMLFileViewer"
import {ImageFileViewer} from "./ImageFileViewer"
import {PDFFileViewer} from "./PDFFileViewer"
import {AudioFileViewer} from "./AudioFileViewer"
import {VideoFileViewer} from "./VideoFileViewer"
import {TextFileEditor} from "./TextFileEditor"
import {ReadOnlyTextViewer} from "./ReadOnlyTextViewer"
import {fileMode, modeNotice, type LoadState} from "./file-mode"
import {DocHandle} from "@automerge/automerge-repo/slim"
import {UnixFileEntry} from "@inkandswitch/patchwork-filesystem"
import {PatchworkViewElement} from "@inkandswitch/patchwork-elements"

// How long to wait for the handle before saying so, instead of "Loading..."
const SLOW_LOAD_MS = 10_000

export function FileEditor(props: {
	handle: DocHandle<UnixFileEntry>
	element: PatchworkViewElement
}) {
	const handle = useDocHandle<FileDoc>(props.handle.url, props.element)
	const doc = createDocumentProjection<FileDoc>(() => handle.latest)

	const [timedOut, setTimedOut] = createSignal(false)
	const timer = setTimeout(() => setTimedOut(true), SLOW_LOAD_MS)
	onCleanup(() => clearTimeout(timer))

	const load = (): LoadState =>
		doc()
			? "ready"
			: handle.error
				? "failed"
				: timedOut()
					? "timed-out"
					: "loading"

	// The one decision about how to show this file. Reads the read-only flag
	// each time the doc changes rather than once.
	const mode = createMemo(() =>
		fileMode({
			doc: doc(),
			load: load(),
			readOnly: props.handle.isReadOnly(),
		}),
	)
	const notice = () => modeNotice(mode())
	const media = () => {
		const m = mode()
		return m.kind === "media" ? m.media : undefined
	}

	return (
		<div
			data-file-mode={mode().kind}
			style={{display: "flex", "flex-direction": "column", height: "100%"}}>
			<Show when={notice()}>
				<div
					style={{
						padding: "0.2em 0.6em",
						"font-size": "0.8em",
						color: "var(--editor-line)",
					}}>
					{notice()}
				</div>
			</Show>
			<div style={{flex: 1, "min-height": 0}}>
				<Switch>
					<Match when={mode().kind === "loading"}>Loading...</Match>
					<Match when={media() === "html"}>
						<HTMLFileViewer doc={doc()!} />
					</Match>
					<Match when={media() === "image"}>
						<ImageFileViewer doc={doc()!} />
					</Match>
					<Match when={media() === "pdf"}>
						<PDFFileViewer doc={doc()!} />
					</Match>
					<Match when={media() === "audio"}>
						<AudioFileViewer doc={doc()!} />
					</Match>
					<Match when={media() === "video"}>
						<VideoFileViewer doc={doc()!} />
					</Match>
					<Match when={mode().kind === "text"}>
						<TextFileEditor
							doc={doc()!}
							handle={props.handle}
							element={props.element}
						/>
					</Match>
					<Match
						when={
							mode().kind === "text-readonly" || mode().kind === "bytes-text"
						}>
						<ReadOnlyTextViewer
							doc={doc()!}
							handle={props.handle as any}
							element={props.element}
						/>
					</Match>
					{/* unavailable and unknown-binary say why in the notice above */}
				</Switch>
			</div>
		</div>
	)
}
