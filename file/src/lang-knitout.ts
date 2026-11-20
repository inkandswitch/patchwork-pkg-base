// Knitout (https://textiles-lab.github.io/knitout/knitout.html), the
// line-oriented machine-knitting format. Shaped like a @codemirror/lang-*
// package: `knitout()` is the LanguageSupport, `knitoutParser` the stream
// parser underneath it.
//
//   ;!knitout-2              magic line
//   ;;Carriers: 1 2 3        header (only directly after the magic line)
//   knit + f14 A B ;note     opcode, direction, needle, carrier set, comment
//   xfer f3 bs-3 ;!source: knit.js:53
import {
	LanguageSupport,
	StreamLanguage,
	type StreamParser,
	type StringStream,
} from "@codemirror/language"

// Each opcode's parameters, in order. "CS" (carrier set) takes the rest of
// the line, so it's always last.
type Param = "D" | "N" | "CS" | "num"
const OPCODES: Record<string, Param[]> = {
	in: ["CS"],
	inhook: ["CS"],
	releasehook: ["CS"],
	out: ["CS"],
	outhook: ["CS"],
	stitch: ["num", "num"],
	rack: ["num"],
	knit: ["D", "N", "CS"],
	tuck: ["D", "N", "CS"],
	split: ["D", "N", "N", "CS"],
	drop: ["N"],
	amiss: ["N"],
	xfer: ["N", "N"],
	miss: ["D", "N", "CS"],
	pause: [],
}

const NEEDLE = /^(?:fs|bs|f|b)-?\d+$/
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)$/
const DIRECTION = /^[+-]$/

type State = {
	line: number
	// Still in the comment header (magic line plus the `;;` lines after it).
	header: boolean
	// The current line's opcode's parameters, or null for an unknown opcode
	// (whose arguments get highlighted by shape alone). Undefined before the
	// opcode has been read.
	params: Param[] | null | undefined
	arg: number
	// Header line: whether the `Name:` part has been read.
	headerName: boolean
}

// Highlight an argument by what it looks like, for x-* opcodes.
function byShape(word: string): string {
	if (DIRECTION.test(word)) return "operator"
	if (NEEDLE.test(word)) return "variableName"
	if (NUMBER.test(word)) return "number"
	return "string"
}

function argument(word: string, param: Param | undefined): string {
	switch (param) {
		case "D":
			return DIRECTION.test(word) ? "operator" : "invalid"
		case "N":
			return NEEDLE.test(word) ? "variableName" : "invalid"
		case "num":
			return NUMBER.test(word) ? "number" : "invalid"
		case "CS":
			return /[,;]/.test(word) ? "invalid" : "string"
		default:
			return "invalid"
	}
}

export const knitoutParser: StreamParser<State> = {
	name: "knitout",

	startState: () => ({
		line: 0,
		header: true,
		params: undefined,
		arg: 0,
		headerName: false,
	}),

	copyState: state => ({...state}),

	token(stream: StringStream, state: State): string | null {
		if (stream.sol()) {
			state.params = undefined
			state.arg = 0
			state.headerName = false
			const first = state.line++ === 0
			if (first && stream.match(/^;!knitout-\d+\s*$/)) return "meta"
			if (!stream.match(/^\s*;;/, false)) state.header = false
			else if (state.header) {
				stream.match(/^\s*;;/)
				return "meta"
			}
		}

		if (stream.eatSpace()) return null

		// The rest of a header line: `Name: value`.
		if (state.header) {
			if (!state.headerName) {
				state.headerName = true
				if (stream.match(/^[^:\s]+(?=:)/)) return "attributeName"
			}
			if (stream.eat(":")) return "punctuation"
			stream.skipToEnd()
			return "string"
		}

		if (stream.peek() === ";") {
			if (stream.match(/^;!source:/)) {
				stream.skipToEnd()
				return "meta"
			}
			stream.skipToEnd()
			return "lineComment"
		}

		const word = stream.match(/^[^\s;]+/) as RegExpMatchArray | null
		if (!word) {
			stream.next()
			return null
		}
		const text = word[0]

		if (state.params === undefined) {
			if (text in OPCODES) {
				state.params = OPCODES[text]
				return "keyword"
			}
			state.params = null
			return text.startsWith("x-") ? "keyword" : "invalid"
		}

		if (state.params === null) return byShape(text)
		const params = state.params
		const index = Math.min(state.arg++, params.length - 1)
		// A carrier set swallows everything after it; anything else past the
		// end of the parameter list is one too many.
		if (state.arg > params.length && params[params.length - 1] !== "CS")
			return "invalid"
		return argument(text, params[index])
	},

	languageData: {
		commentTokens: {line: ";"},
	},
}

export const knitoutLanguage = StreamLanguage.define(knitoutParser)

export function knitout(): LanguageSupport {
	return new LanguageSupport(knitoutLanguage)
}
