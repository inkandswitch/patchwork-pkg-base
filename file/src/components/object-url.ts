import {createMemo, onCleanup} from "solid-js"

// An object URL for a blob that follows its source: the previous URL is
// revoked whenever the blob changes, and the last one when the owner goes away.
export function createObjectUrl(make: () => Blob | undefined) {
	return createMemo(() => {
		const blob = make()
		if (!blob) return undefined
		const url = URL.createObjectURL(blob)
		onCleanup(() => URL.revokeObjectURL(url))
		return url
	})
}
