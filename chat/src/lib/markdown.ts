// Markdown for the computer's replies. Human messages keep the chat syntax
// (lib/syntax.ts), where `*x*` is bold, not italic.
//
// A reply is split into chunks: fenced code stays separate so MessageBody can
// render it with the streaming shiki <CodeBlock>, and the runs between are
// rendered to sanitized HTML. An unclosed fence runs to the end of the text,
// so a code block that's still streaming is already a code chunk.

import {Marked, type Token, type TokensList} from "marked"
import DOMPurify from "dompurify"

export type MarkdownChunk =
	| {kind: "code"; lang: string; code: string}
	| {kind: "html"; html: string}

const marked = new Marked({gfm: true, breaks: true})

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
	if (node.tagName === "A" && node.hasAttribute("href")) {
		node.setAttribute("target", "_blank")
		node.setAttribute("rel", "noopener")
	}
})

export function markdownChunks(text: string): MarkdownChunk[] {
	const tokens = marked.lexer(text)
	const chunks: MarkdownChunk[] = []
	let run: Token[] = []
	const flush = () => {
		if (run.length) chunks.push({kind: "html", html: toHtml(run, tokens.links)})
		run = []
	}
	for (const token of tokens) {
		if (token.type === "code") {
			flush()
			chunks.push({kind: "code", lang: token.lang?.split(/\s/)[0] ?? "", code: token.text})
		} else {
			run.push(token)
		}
	}
	flush()
	return chunks
}

function toHtml(tokens: Token[], links: TokensList["links"]): string {
	const list = Object.assign(tokens, {links}) as TokensList
	return DOMPurify.sanitize(marked.parser(list))
}
