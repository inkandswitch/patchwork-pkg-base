import type {FileDoc} from "../types"
import {
	isBinaryFileDoc,
	isImmutableStringFileDoc,
	isTextBytesFileDoc,
	isTextFileDoc,
} from "../datatype"
import {isImageFile} from "../utils"
import {isHTMLFile} from "./HTMLFileViewer"
import {isPDFFile} from "./PDFFileViewer"
import {isAudioFile} from "./AudioFileViewer"
import {isVideoFile} from "./VideoFileViewer"

// How the file editor shows a file. One value, computed once by `fileMode`,
// then rendered with one <Switch> on `kind` (and reflected onto the root
// element as data-file-mode so you can see which one you're in).

export type LoadState = "loading" | "timed-out" | "failed" | "ready"

export type MediaKind = "image" | "pdf" | "audio" | "video" | "html"

export type ReadOnlyReason = "immutable-string" | "read-only-handle"

export type FileMode =
	| {kind: "loading"}
	| {kind: "unavailable"; reason: string}
	| {kind: "text"}
	| {kind: "text-readonly"; reason: ReadOnlyReason}
	| {kind: "media"; media: MediaKind}
	| {kind: "bytes-text"}
	| {kind: "unknown-binary"; mimeType: string; size: number}

export type FileModeInput = {
	// undefined until the handle has resolved and the doc is readable
	doc: FileDoc | undefined
	load: LoadState
	// handle.isReadOnly(): a view of the file at some heads, say
	readOnly: boolean
}

// Media is matched on the bytes: a string-backed file is text whatever its
// extension says, so a string SVG is editable markup and a bytes SVG is an image.
// HTML is the exception; it renders from either.
const mediaKind = (doc: FileDoc): MediaKind | undefined => {
	if (isHTMLFile(doc)) return "html"
	if (!isBinaryFileDoc(doc)) return undefined
	if (isImageFile(doc) || doc.mimeType?.startsWith("image/")) return "image"
	if (isPDFFile(doc)) return "pdf"
	if (isAudioFile(doc)) return "audio"
	if (isVideoFile(doc)) return "video"
	return undefined
}

export function fileMode({doc, load, readOnly}: FileModeInput): FileMode {
	if (!doc) {
		if (load === "failed") {
			return {kind: "unavailable", reason: "This file couldn't be opened."}
		}
		if (load === "timed-out") {
			return {
				kind: "unavailable",
				reason:
					"This file hasn't loaded yet. It may not be shared with you, or nobody who has it is online.",
			}
		}
		return {kind: "loading"}
	}

	const media = mediaKind(doc)
	if (media) return {kind: "media", media}

	if (isTextFileDoc(doc) || isImmutableStringFileDoc(doc)) {
		if (isImmutableStringFileDoc(doc)) {
			return {kind: "text-readonly", reason: "immutable-string"}
		}
		if (readOnly) return {kind: "text-readonly", reason: "read-only-handle"}
		return {kind: "text"}
	}

	if (isBinaryFileDoc(doc)) {
		if (isTextBytesFileDoc(doc)) return {kind: "bytes-text"}
		return {
			kind: "unknown-binary",
			mimeType: doc.mimeType || "unknown type",
			size: doc.content.length,
		}
	}

	return {kind: "unavailable", reason: "This file's content isn't in a form we can show."}
}

// A plain-words line for every mode that isn't the ordinary one.
export function modeNotice(mode: FileMode): string | undefined {
	switch (mode.kind) {
		case "text-readonly":
			return mode.reason === "immutable-string"
				? "Read-only: this file's text is stored as a single value that is replaced whole, not edited."
				: "Read-only: you're looking at a past version of this file."
		case "bytes-text":
			return "Read-only: this file is stored as bytes that happen to be text."
		case "unknown-binary":
			return `No preview: ${mode.mimeType}, ${formatSize(mode.size)}.`
		case "unavailable":
			return mode.reason
		default:
			return undefined
	}
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} bytes`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
