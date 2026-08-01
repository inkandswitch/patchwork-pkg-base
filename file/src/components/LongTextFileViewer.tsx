import {onCleanup} from "solid-js"
import {accept, type SubscribeEvent} from "@inkandswitch/patchwork-providers"
import type {FileDoc} from "../types"
import {pluginsForFile} from "../plugins"

// Kept in step with text-editor/src/lib/read-only.ts. The editor asks whether
// it's read-only and never learns why; here the reason is "this file is too big
// to edit comfortably", which is nobody else's business.
const READ_ONLY = "patchwork:read-only"

export function LongTextFileViewer(props: {doc: FileDoc; handle: any}) {
	const answerReadOnly = (event: Event) => {
		const subscribeEvent = event as SubscribeEvent
		if (subscribeEvent.detail.selector.type !== READ_ONLY) return
		accept<boolean>(subscribeEvent, respond => respond(true))
	}

	return (
		<div
			ref={el => {
				el.addEventListener("patchwork:subscribe", answerReadOnly)
				onCleanup(() =>
					el.removeEventListener("patchwork:subscribe", answerReadOnly),
				)
			}}
			style={{width: "100%", height: "100%"}}>
			<patchwork-view
				component="text-editor"
				doc-url={props.handle.url}
				plugins={pluginsForFile(
					props.doc.extension,
					props.doc.mimeType,
				).join(",")}
				style={{width: "100%", height: "100%"}}
			/>
		</div>
	)
}
