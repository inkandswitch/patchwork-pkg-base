import {describe, expect, it} from "vitest"
import {formatTranscript} from "./transcript"
import type {ChatMessage} from "../types"

const message = (m: Partial<ChatMessage>): ChatMessage => ({
	id: "1",
	name: "paul",
	text: "hello",
	timestamp: 1_700_000_000_000,
	...m,
})

describe("formatTranscript", () => {
	it("writes a heading and one section per message", () => {
		const out = formatTranscript(
			[
				message({id: "a", text: "hello"}),
				message({id: "b", name: "computer", text: "hi", isComputer: true}),
			],
			"Chat 1"
		)
		expect(out).toMatch(/^# Chat 1\n/)
		expect(out).toContain("2 messages")
		expect(out).toContain("**paul**")
		expect(out).toContain("hello")
		expect(out).toContain("**computer**")
		expect(out).toContain("hi")
	})

	it("keeps tool calls and their results", () => {
		const out = formatTranscript([
			message({
				name: "computer",
				text: "reading it",
				richBlocks: [
					{type: "tool-call", content: 'read_doc {"url":"x"}', result: "{}"},
				],
			}),
		])
		expect(out).toContain("```tool-call\nread_doc {\"url\":\"x\"}\n```")
		expect(out).toContain("```tool-call-result\n{}\n```")
	})

	it("lengthens the fence around a body that contains backticks", () => {
		const out = formatTranscript([
			message({richBlocks: [{type: "code", content: "```js\nx\n```"}]}),
		])
		expect(out).toContain("````code\n```js\nx\n```\n````")
	})

	it("names attachments and the message a reply answers", () => {
		const out = formatTranscript([
			message({id: "a", text: "look at this"}),
			message({
				id: "b",
				name: "chee",
				text: "nice",
				replyTo: "a",
				imageUrl: "automerge:img" as any,
				imageName: "shot.png",
			}),
		])
		expect(out).toContain("> in reply to **paul**: look at this")
		expect(out).toContain("[image: shot.png automerge:img]")
	})
})
