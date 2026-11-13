import {describe, expect, it} from "vitest"
import {EditorView} from "@codemirror/view"
import {history, undo} from "@codemirror/commands"
import {next as A} from "@automerge/automerge"
import {automergeSyncPlugin} from "@automerge/automerge-codemirror"

type Doc = {content: string}

// Just enough of a DocHandle for the sync plugin: a doc, change(), and a
// "change" event.
function fakeHandle(content: string) {
	let doc = A.from<Doc>({content})
	const listeners = new Set<() => void>()
	return {
		isReady: () => true,
		doc: () => doc,
		change(fn: (doc: Doc) => void) {
			doc = A.change(doc, fn)
			for (const listener of listeners) listener()
		},
		on: (_: "change", listener: () => void) => listeners.add(listener),
		off: (_: "change", listener: () => void) => listeners.delete(listener),
	}
}

describe("automergeSyncPlugin", () => {
	// patched in patches/@automerge__automerge-codemirror@0.1.0.patch
	it("keeps a peer's edits out of local undo", () => {
		const handle = fakeHandle("hello")
		const view = new EditorView({
			doc: "hello",
			extensions: [
				history(),
				automergeSyncPlugin({handle: handle as any, path: ["content"]}),
			],
		})

		// we type
		view.dispatch({
			changes: {from: 5, insert: " world"},
			userEvent: "input.type",
		})
		expect(handle.doc().content).toBe("hello world")

		// a peer edits, arriving as a change to the handle
		handle.change((doc) => A.splice(doc, ["content"], 0, 0, ">> "))
		expect(view.state.doc.toString()).toBe(">> hello world")

		// undo takes back our typing, not theirs
		undo(view)
		expect(view.state.doc.toString()).toBe(">> hello")
		expect(handle.doc().content).toBe(">> hello")

		view.destroy()
	})
})
