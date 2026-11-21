// The page's side of the files a tool embedding the editor gives the
// TypeScript language server (tsgo/files.ts is the worker's). It's handed out
// as `detail.languageServer` on the extensions event, which comes before the
// server has started, so what's said until then waits here (only the latest
// for each path) and goes to the worker once there is one.
import type {FileChange} from "./tsgo/files"

export type LanguageServerFiles = {
	// `path` is in the server's filesystem, rooted at `/`, where each open
	// editor's file is `/<documentId>/index.<ext>`
	writeFile(path: string, text: string): void
	removeFile(path: string): void
}

export function createLanguageServerFiles() {
	let post: ((change: FileChange) => void) | undefined
	const waiting = new Map<string, FileChange>()
	const send = (path: string, change: FileChange) => {
		if (post) return post(change)
		waiting.delete(path)
		waiting.set(path, change)
	}
	return {
		writeFile(path: string, text: string) {
			send(path, {writeFile: {path, text}})
		},
		removeFile(path: string) {
			send(path, {removeFile: {path}})
		},
		// once the server's worker is there
		connect(to: (change: FileChange) => void) {
			post = to
			for (const change of waiting.values()) to(change)
			waiting.clear()
		},
	}
}

// one for the page, like the server
export const languageServerFiles = createLanguageServerFiles()
