import {describe, expect, it} from "vitest"
import {ImmutableString} from "@automerge/automerge"
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

	it("doesn't take plain strings or bytes for one", () => {
		expect(isImmutableStringFileDoc(file("plain"))).toBe(false)
		expect(isImmutableStringFileDoc(file(new Uint8Array([1, 2])))).toBe(false)
		expect(fileText(file("plain"))).toBe("plain")
	})
})
