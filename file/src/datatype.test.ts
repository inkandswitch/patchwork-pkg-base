import {describe, expect, it} from "vitest"
import {ImmutableString} from "@automerge/automerge"
import {createStore} from "solid-js/store"
import {fileText, isImmutableStringFileDoc} from "./datatype"
import {isTextFile} from "./components/TextFileEditor"
import type {FileDoc} from "./types"

const file = (content: unknown) =>
	({name: "pattern.k", extension: "k", mimeType: "text/plain", content}) as unknown as FileDoc

describe("ImmutableString files", () => {
	it("are recognised, and so is a structuredClone of one", () => {
		const immutable = new ImmutableString("knit + f1 1")
		const cloned = structuredClone(immutable)
		for (const content of [immutable, cloned]) {
			expect(isImmutableStringFileDoc(file(content))).toBe(true)
			expect(isTextFile(file(content))).toBe(true)
			expect(fileText(file(content))).toBe("knit + f1 1")
		}
	})

	it("are recognised inside solid-automerge's projection of the doc", () => {
		// the projection keeps a solid store of the doc; once the file's content
		// is written as an ImmutableString, the store holds a proxy of {val}
		const [projection, set] = createStore({content: "" as unknown})
		set("content", structuredClone(new ImmutableString("in 3")))
		expect(isImmutableStringFileDoc(file(projection.content))).toBe(true)
		expect(fileText(file(projection.content))).toBe("in 3")
	})

	it("doesn't take plain strings or bytes for one", () => {
		expect(isImmutableStringFileDoc(file("plain"))).toBe(false)
		expect(isImmutableStringFileDoc(file(new Uint8Array([1, 2])))).toBe(false)
		expect(fileText(file("plain"))).toBe("plain")
	})
})
