// File datatype implementation

import {isImmutableString} from "@automerge/automerge-repo/slim"
import {BinaryFileDoc, FileDoc, TextFileDoc} from "./types"

export function isBinaryFileDoc(doc: FileDoc): doc is BinaryFileDoc {
	return doc.content instanceof Uint8Array
}

export function isTextFileDoc(doc: FileDoc): doc is TextFileDoc {
	return typeof doc.content === "string"
}

// An ImmutableString that's been through structuredClone (as solid-automerge's
// document projection does) loses its symbol marker and its prototype and
// comes out as a plain {val: "..."}, so that counts as one too.
const isClonedImmutableString = (content: unknown): content is {val: string} =>
	typeof content === "object" &&
	content !== null &&
	!(content instanceof Uint8Array) &&
	typeof (content as {val?: unknown}).val === "string"

export const isImmutableStringFileDoc = (doc: FileDoc): boolean => {
	return isImmutableString(doc.content) || isClonedImmutableString(doc.content)
}

// The text of a text file, whichever way it's stored (a string, an
// ImmutableString, or a cloned one).
export const fileText = (doc: FileDoc | undefined): string => {
	const content = doc?.content as unknown
	if (typeof content === "string") return content
	if (isClonedImmutableString(content)) return content.val
	if (isImmutableString(content)) return content.toString()
	return ""
}

// Get file contents as string or Uint8Array
export const getFileContents = (doc: FileDoc): string | Uint8Array => {
	if (isBinaryFileDoc(doc)) {
		return doc.content
	} else if (typeof doc.content === "string") {
		return doc.content
	} else if (
		"toString" in doc.content &&
		typeof doc.content.toString == "function"
	) {
		const content = doc.content
		return content.toString()
	} else {
		throw new Error("Unsupported file content type")
	}
}

// Datatype implementation
export const FileDatatype = {
	init(doc: FileDoc) {
		doc.name = ""
		doc.extension = ""
		doc.mimeType = ""
		doc.content = ""
	},

	setTitle(doc: FileDoc, title: string) {
		doc.name = title
	},

	getTitle(doc: FileDoc) {
		return doc.name || "Untitled File"
	},
}
