// @vitest-environment jsdom
// happy-dom's parser makes DOMPurify drop the first top-level element.
import {describe, expect, it} from "vitest"
import {markdownChunks} from "./markdown"

describe("markdownChunks", () => {
	it("renders prose as HTML and keeps fenced code separate", () => {
		const chunks = markdownChunks("# Plan\n\n- **one**\n- two\n\n```ts\nconst x = 1\n```\n\nDone.")
		expect(chunks.map((c) => c.kind)).toEqual(["html", "code", "html"])
		expect(chunks[0]).toMatchObject({kind: "html"})
		const html = (chunks[0] as {html: string}).html
		expect(html).toContain("<h1>Plan</h1>")
		expect(html).toContain("<strong>one</strong>")
		expect(chunks[1]).toEqual({kind: "code", lang: "ts", code: "const x = 1"})
	})

	it("treats an unclosed fence as code that's still streaming", () => {
		const chunks = markdownChunks("Here:\n\n```js\nlet a =")
		expect(chunks.at(-1)).toEqual({kind: "code", lang: "js", code: "let a ="})
	})

	it("renders tables", () => {
		const [chunk] = markdownChunks("| a | b |\n|---|---|\n| 1 | 2 |")
		expect((chunk as {html: string}).html).toContain("<table>")
	})

	it("strips scripts and opens links in a new tab", () => {
		const [chunk] = markdownChunks('[x](https://example.com) <img src=x onerror="alert(1)"><script>alert(1)</script>')
		const html = (chunk as {html: string}).html
		expect(html).not.toContain("onerror")
		expect(html).not.toContain("<script")
		expect(html).toContain('target="_blank"')
		expect(html).toContain('rel="noopener"')
	})
})
