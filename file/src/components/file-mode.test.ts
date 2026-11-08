import {describe, expect, it} from "vitest"
import {ImmutableString} from "@automerge/automerge"
import {fileMode, modeNotice} from "./file-mode"
import type {FileDoc} from "../types"

const file = (extension: string, content: unknown, mimeType = "") =>
	({name: `f.${extension}`, extension, mimeType, content}) as unknown as FileDoc

const bytes = (...n: number[]) => new Uint8Array(n)
const text = (s: string) => new TextEncoder().encode(s)
const ready = (doc: FileDoc, readOnly = false) =>
	fileMode({doc, load: "ready", readOnly})

describe("fileMode: before there is a doc", () => {
	it("is loading while the handle resolves", () => {
		expect(fileMode({doc: undefined, load: "loading", readOnly: false})).toEqual({kind: "loading"})
	})
	it("is unavailable, with a reason, when it fails or takes too long", () => {
		for (const load of ["failed", "timed-out"] as const) {
			const mode = fileMode({doc: undefined, load, readOnly: false})
			expect(mode.kind).toBe("unavailable")
			expect(modeNotice(mode)).toBeTruthy()
		}
	})
	it("a doc that arrived wins over a timeout", () => {
		expect(fileMode({doc: file("txt", "hi"), load: "ready", readOnly: false}).kind).toBe("text")
	})
})

describe("fileMode: text", () => {
	it("a string file is editable", () => {
		expect(ready(file("ts", "const a = 1"))).toEqual({kind: "text"})
	})
	it("a string SVG is editable text, not an image", () => {
		expect(ready(file("svg", "<svg/>", "image/svg+xml"))).toEqual({kind: "text"})
	})
	it("a read-only handle makes text read-only, and says so", () => {
		const mode = ready(file("txt", "hi"), true)
		expect(mode).toEqual({kind: "text-readonly", reason: "read-only-handle"})
		expect(modeNotice(mode)).toMatch(/past version/)
	})
	it("an ImmutableString (or a clone of one) is read-only, and says so", () => {
		for (const c of [new ImmutableString("x"), structuredClone(new ImmutableString("x"))]) {
			const mode = ready(file("k", c))
			expect(mode).toEqual({kind: "text-readonly", reason: "immutable-string"})
			expect(modeNotice(mode)).toMatch(/replaced whole/)
		}
	})
	it("the reason is not the same for the two", () => {
		expect(modeNotice(ready(file("k", new ImmutableString("x"))))).not.toBe(
			modeNotice(ready(file("k", "x"), true)),
		)
	})
})

describe("fileMode: media", () => {
	it("a bytes SVG is an image", () => {
		expect(ready(file("svg", text("<svg/>"), "image/svg+xml"))).toEqual({kind: "media", media: "image"})
	})
	it("png, pdf, audio, video by their bytes", () => {
		expect(ready(file("png", bytes(0x89, 0, 1, 2), "image/png"))).toEqual({kind: "media", media: "image"})
		expect(ready(file("pdf", bytes(0, 1, 2), "application/pdf"))).toEqual({kind: "media", media: "pdf"})
		expect(ready(file("mp3", bytes(0, 1, 2), "audio/mpeg"))).toEqual({kind: "media", media: "audio"})
		expect(ready(file("mp4", bytes(0, 1, 2), "video/mp4"))).toEqual({kind: "media", media: "video"})
	})
	it("html renders from strings and from bytes", () => {
		expect(ready(file("html", "<p>"))).toEqual({kind: "media", media: "html"})
		expect(ready(file("html", text("<p>")))).toEqual({kind: "media", media: "html"})
	})
	it("a string .ts stays text even though mime detection says video/mp2t", () => {
		expect(ready(file("ts", "let a", "video/mp2t"))).toEqual({kind: "text"})
	})
})

describe("fileMode: bytes", () => {
	it("bytes that are text show as read-only text", () => {
		const mode = ready(file("txt", text("hello"), "text/plain"))
		expect(mode).toEqual({kind: "bytes-text"})
		expect(modeNotice(mode)).toMatch(/bytes/)
	})
	it("other bytes are unknown binary, with mime and size", () => {
		const mode = ready(file("bin", bytes(0, 1, 2, 0, 0), "application/x-thing"))
		expect(mode).toEqual({kind: "unknown-binary", mimeType: "application/x-thing", size: 5})
		expect(modeNotice(mode)).toMatch(/application\/x-thing, 5 bytes/)
	})
})
