import {describe, expect, it} from "vitest"
import {
	CODEMIRROR_EXTENSIONS_EVENT,
	collectExtensions,
	type CodemirrorExtensionsDetail,
} from "./codemirror-extensions"

const file = (extension: string) =>
	({name: `index.${extension}`, extension, mimeType: "text/plain", content: ""}) as any

function ask(extension: string, readOnly = false) {
	const element = document.createElement("div")
	let heard: CodemirrorExtensionsDetail | undefined
	element.addEventListener(CODEMIRROR_EXTENSIONS_EVENT, (event) => {
		heard = (event as CustomEvent<CodemirrorExtensionsDetail>).detail
		heard.completionSources?.push(() => null)
	})
	const collected = collectExtensions(element, {}, file(extension), readOnly)
	return {heard: heard!, collected}
}

describe("the codemirror extensions event", () => {
	it("gives a code file's embedder the language server and somewhere for completions", () => {
		const {heard, collected} = ask("js")
		expect(typeof heard.languageServer?.writeFile).toBe("function")
		expect(typeof heard.languageServer?.removeFile).toBe("function")
		expect(heard.completionSources).toHaveLength(1)
		expect(collected.completionSources).toHaveLength(1)
	})

	it("gives a typescript file them too", () => {
		expect(ask("tsx").heard.languageServer).toBeDefined()
	})

	it("leaves them out for files without the language server", () => {
		for (const {heard} of [ask("md"), ask("js", true)]) {
			expect(heard.languageServer).toBeUndefined()
			expect(heard.completionSources).toBeUndefined()
		}
	})

	it("still collects extensions", () => {
		const element = document.createElement("div")
		element.addEventListener(CODEMIRROR_EXTENSIONS_EVENT, (event) => {
			;(event as CustomEvent<CodemirrorExtensionsDetail>).detail.extensions.push("x" as any)
		})
		expect(collectExtensions(element, {}, file("md"), false).extensions).toEqual(["x"])
		expect(collectExtensions(undefined, {}, file("js"), false).extensions).toEqual([])
	})
})
