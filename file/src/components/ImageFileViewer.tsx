import type {FileDoc} from "../types"
import {isBinaryFileDoc} from "../datatype"
import {createObjectUrl} from "./object-url"

export type ImageFileDoc = FileDoc & {
	extension: "svg" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp"
}

export function ImageFileViewer(props: {doc: FileDoc}) {
	const imgUrl = createObjectUrl(() => {
		if (isBinaryFileDoc(props.doc)) {
			const type = props.doc.mimeType
			return new Blob([props.doc.content as BlobPart], type ? {type} : {})
		}
		return undefined
	})

	return imgUrl() ? (
		<img
			src={imgUrl()}
			alt={props.doc.name}
			style={{
				"max-width": "100%",
				"max-height": "100%",
				"object-fit": "contain",
			}}
		/>
	) : (
		<div
			style={{
				background: "var(--editor-fill)",
				color: "var(--editor-line)",
			}}>
			No image to display
		</div>
	)
}
