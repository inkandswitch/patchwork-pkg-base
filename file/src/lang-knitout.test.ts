import {describe, it, expect} from "vitest"
import {StringStream} from "@codemirror/language"
import {knitoutParser} from "./lang-knitout"
import {getLanguageExtension} from "./languages"

// Run the stream parser over a whole file, returning each line's non-space
// tokens as [text, style] pairs.
function tokenize(source: string): [string, string | null][][] {
	const state = knitoutParser.startState!(2)
	return source.split("\n").map(line => {
		const stream = new StringStream(line, 2, 2)
		const tokens: [string, string | null][] = []
		while (!stream.eol()) {
			const style = knitoutParser.token(stream, state)
			const text = stream.current()
			if (text.trim()) tokens.push([text, style])
			stream.start = stream.pos
		}
		return tokens
	})
}

const styles = (line: [string, string | null][]) => line.map(([, s]) => s)

describe("knitout", () => {
	const file = [
		";!knitout-2",
		";;Machine: SWG091N2",
		";;Carriers: 1 2 3",
		";;Yarn-5: 50-50 Rust",
		"inhook 5",
		"knit + f14 A B ;knit together",
		"tuck - b-2 C",
		"split + f3 bs3 B",
		"xfer f3 b3",
		"rack -1.75",
		"stitch -7.5 30",
		"knit + f1 A ;!source: knit.js:53",
		";;Machine: not a header any more",
		"x-presser on",
		"pause",
	].join("\n")
	const lines = tokenize(file)

	it("reads the magic line and header", () => {
		expect(lines[0]).toEqual([[";!knitout-2", "meta"]])
		expect(lines[1]).toEqual([
			[";;", "meta"],
			["Machine", "attributeName"],
			[":", "punctuation"],
			["SWG091N2", "string"],
		])
		expect(lines[3].at(-1)).toEqual(["50-50 Rust", "string"])
	})

	it("highlights opcodes by their parameter shapes", () => {
		expect(lines[5]).toEqual([
			["knit", "keyword"],
			["+", "operator"],
			["f14", "variableName"],
			["A", "string"],
			["B", "string"],
			[";knit together", "lineComment"],
		])
		expect(styles(lines[6])).toEqual([
			"keyword",
			"operator",
			"variableName",
			"string",
		])
		expect(styles(lines[7])).toEqual([
			"keyword",
			"operator",
			"variableName",
			"variableName",
			"string",
		])
		expect(styles(lines[8])).toEqual(["keyword", "variableName", "variableName"])
		expect(styles(lines[9])).toEqual(["keyword", "number"])
		expect(styles(lines[10])).toEqual(["keyword", "number", "number"])
	})

	it("treats carriers as carriers even when they look like numbers", () => {
		expect(lines[4]).toEqual([
			["inhook", "keyword"],
			["5", "string"],
		])
	})

	it("marks source comments, and ;; lines after the header as comments", () => {
		expect(lines[11].at(-1)).toEqual([";!source: knit.js:53", "meta"])
		expect(styles(lines[12])).toEqual(["lineComment"])
	})

	it("allows x- extensions and parameterless pause", () => {
		expect(styles(lines[13])).toEqual(["keyword", "string"])
		expect(styles(lines[14])).toEqual(["keyword"])
	})

	it("flags unknown opcodes and malformed arguments", () => {
		const [unknown, badDirection, extra, badNeedle] = tokenize(
			["purl + f1 A", "knit f1 A", "xfer f1 b1 b2", "drop q1"].join("\n"),
		)
		expect(unknown[0]).toEqual(["purl", "invalid"])
		expect(badDirection[1]).toEqual(["f1", "invalid"])
		expect(extra.at(-1)).toEqual(["b2", "invalid"])
		expect(badNeedle[1]).toEqual(["q1", "invalid"])
	})

	it("is picked for .k and .knitout files", () => {
		for (const ext of [".k", "knitout"]) {
			const support = getLanguageExtension(ext)
			expect(Array.isArray(support) && support.length === 0).toBe(false)
		}
	})
})
