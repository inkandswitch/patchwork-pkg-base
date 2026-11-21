// @vitest-environment node
// the real tsgo (its wasm, from node_modules), on the tsconfig the worker
// gives it: under a second
import {beforeAll, describe, expect, it} from "vitest"
import {readFileSync} from "node:fs"
import {createRequire} from "node:module"
import {startTsgo, type Tsgo} from "./host"
import {changeFile} from "./files"
import {TSCONFIG} from "./tsconfig"

const MAIN = "file:///main/index.js"

let tsgo: Tsgo
let nextId = 1
const waiting = new Map<number, (result: any) => void>()

function request(method: string, params: unknown): Promise<any> {
	const id = nextId++
	return new Promise((resolve) => {
		waiting.set(id, resolve)
		tsgo.send(JSON.stringify({jsonrpc: "2.0", id, method, params}))
	})
}

function notify(method: string, params: unknown) {
	tsgo.send(JSON.stringify({jsonrpc: "2.0", method, params}))
}

const definition = (line: number, character: number) =>
	request("textDocument/definition", {
		textDocument: {uri: MAIN},
		position: {line, character},
	}).then((result) => [result].flat()[0]?.uri)

let version = 0
function edit(text: string) {
	notify("textDocument/didChange", {
		textDocument: {uri: MAIN, version: ++version},
		contentChanges: [{text}],
	})
}

beforeAll(async () => {
	const wasm = readFileSync(createRequire(import.meta.url).resolve("tsgo-wasm"))
	tsgo = await startTsgo(wasm, (message) => {
		const value = JSON.parse(message)
		if (typeof value.id == "number" && waiting.has(value.id)) {
			waiting.get(value.id)!(value.result)
			waiting.delete(value.id)
		}
	})
	tsgo.fs.writeFile("/tsconfig.json", TSCONFIG)
	tsgo.fs.writeFile("/lib1/index.js", "export function stitch(n) {\n\treturn n\n}\n")
	await request("initialize", {processId: null, rootUri: "file:///", capabilities: {}})
	notify("initialized", {})
	notify("textDocument/didOpen", {
		textDocument: {
			uri: MAIN,
			languageId: "javascript",
			version,
			text: 'import {stitch} from "automerge:lib1"\nstitch(1)\n',
		},
	})
}, 60_000)

describe("tsgo", () => {
	it("finds an automerge: import in that doc's folder", async () => {
		expect(await definition(1, 1)).toBe("file:///lib1/index.js")
	})

	it("finds a /automerge: import, written after it started", async () => {
		changeFile(tsgo, {
			writeFile: {path: "/lib2/index.js", text: "export function tuck(n) {\n\treturn n\n}\n"},
		})
		edit('import {tuck} from "/automerge:lib2"\ntuck(1)\n')
		expect(await definition(1, 1)).toBe("file:///lib2/index.js")
	})

	it("takes types from a .d.ts it's given", async () => {
		changeFile(tsgo, {
			writeFile: {
				path: "/lattice/main.d.ts",
				text: 'declare function doc(url: "automerge:x"): {width: number}\n',
			},
		})
		edit('doc("automerge:x").width\n')
		const hover = await request("textDocument/hover", {
			textDocument: {uri: MAIN},
			position: {line: 0, character: 20},
		})
		expect(JSON.stringify(hover?.contents)).toContain("width: number")
	})
})
