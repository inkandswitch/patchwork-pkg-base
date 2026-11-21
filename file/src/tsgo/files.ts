// files a tool embedding the editor gives tsgo, besides the open editors'
// (language-server-files.ts, on the page). they go in the memfs, and the
// server hears about them as it would from a file watcher
import {resolve} from "./memfs"
import type {Tsgo} from "./host"

export type FileChange =
	| {writeFile: {path: string; text: string}}
	| {removeFile: {path: string}}

// lsp's FileChangeType
const CREATED = 1
const CHANGED = 2
const DELETED = 3

export function changeFile(
	tsgo: Pick<Tsgo, "fs" | "notify" | "refresh">,
	change: FileChange,
) {
	let path: string
	let type: number
	if ("writeFile" in change) {
		path = resolve(change.writeFile.path)
		type = tsgo.fs.writeFile(path, change.writeFile.text) == "created" ? CREATED : CHANGED
	} else {
		path = resolve(change.removeFile.path)
		if (!tsgo.fs.remove(path)) return
		type = DELETED
	}
	tsgo.notify("workspace/didChangeWatchedFiles", {
		changes: [{uri: `file://${path}`, type}],
	})
	// the open files may import it, so they're checked again
	tsgo.refresh()
}
