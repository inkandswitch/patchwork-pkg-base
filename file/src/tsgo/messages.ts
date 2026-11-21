// what the worker does with each message from the page, once tsgo's started:
// LSP goes to the server, and a file goes in its filesystem (./files.ts)
import {changeFile, type FileChange} from "./files"
import type {Tsgo} from "./host"

export type Message = {lsp: string} | FileChange

// one that throws is said so and dropped, so the ones after it (the queued
// initialize, say) still go: otherwise every editor on the page loses the
// language server over one file
export function handleMessage(
	tsgo: Pick<Tsgo, "fs" | "notify" | "refresh" | "send">,
	message: Message,
) {
	try {
		if ("lsp" in message) tsgo.send(message.lsp)
		else changeFile(tsgo, message)
	} catch (error) {
		console.error("[tsgo] couldn't handle a message", error)
	}
}
