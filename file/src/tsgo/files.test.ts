import {describe, expect, it} from "vitest"
import {createMemFS} from "./memfs"
import {changeFile} from "./files"
import {createLanguageServerFiles} from "../language-server-files"

function fakeTsgo() {
	const said: Array<{method: string; params: any}> = []
	let refreshed = 0
	return {
		fs: createMemFS(),
		notify: (method: string, params: unknown) => said.push({method, params}),
		refresh: () => refreshed++,
		said,
		refreshed: () => refreshed,
	}
}

describe("a file an embedder gives tsgo", () => {
	it("is written, announced as created then changed, and re-checked", () => {
		const tsgo = fakeTsgo()
		changeFile(tsgo, {writeFile: {path: "/abc/index.js", text: "export const a = 1"}})
		changeFile(tsgo, {writeFile: {path: "/abc/index.js", text: "export const a = 2"}})
		expect(tsgo.fs.readFile("/abc/index.js")).toBe("export const a = 2")
		expect(tsgo.said).toEqual([
			{
				method: "workspace/didChangeWatchedFiles",
				params: {changes: [{uri: "file:///abc/index.js", type: 1}]},
			},
			{
				method: "workspace/didChangeWatchedFiles",
				params: {changes: [{uri: "file:///abc/index.js", type: 2}]},
			},
		])
		expect(tsgo.refreshed()).toBe(2)
	})

	it("is removed, and announced as deleted", () => {
		const tsgo = fakeTsgo()
		changeFile(tsgo, {writeFile: {path: "/lattice/x.d.ts", text: ""}})
		changeFile(tsgo, {removeFile: {path: "/lattice/x.d.ts"}})
		expect(tsgo.fs.exists("/lattice/x.d.ts")).toBe(false)
		expect(tsgo.said[1].params).toEqual({
			changes: [{uri: "file:///lattice/x.d.ts", type: 3}],
		})
	})

	it("isn't announced when there was nothing to remove", () => {
		const tsgo = fakeTsgo()
		changeFile(tsgo, {removeFile: {path: "/nope.ts"}})
		expect(tsgo.said).toEqual([])
		expect(tsgo.refreshed()).toBe(0)
	})

	it("is put under / when its path isn't", () => {
		const tsgo = fakeTsgo()
		changeFile(tsgo, {writeFile: {path: "lattice/y.d.ts", text: ""}})
		expect(tsgo.fs.exists("/lattice/y.d.ts")).toBe(true)
		expect(tsgo.said[0].params.changes[0].uri).toBe("file:///lattice/y.d.ts")
	})
})

describe("the page's side of those files", () => {
	it("keeps what's said before the server starts, the latest for each path, in order", () => {
		const files = createLanguageServerFiles()
		files.writeFile("/a.ts", "1")
		files.writeFile("/b.ts", "2")
		files.writeFile("/a.ts", "3")
		files.removeFile("/b.ts")
		const posted: unknown[] = []
		files.connect((message) => posted.push(message))
		expect(posted).toEqual([
			{writeFile: {path: "/a.ts", text: "3"}},
			{removeFile: {path: "/b.ts"}},
		])
		files.writeFile("/c.ts", "4")
		expect(posted.at(-1)).toEqual({writeFile: {path: "/c.ts", text: "4"}})
	})
})
