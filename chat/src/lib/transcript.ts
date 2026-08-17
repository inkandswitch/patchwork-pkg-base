// Export a chat's whole conversation as markdown — plain text you can paste
// into another LLM. Most messages live in their own doc (the chat holds a ref),
// so building a transcript means reading every referenced message back.
import type {AutomergeUrl, Repo} from "@automerge/automerge-repo/slim"
import type {ChatDoc, ChatMessage} from "../types"

/** Copy a chat's whole history to the clipboard as markdown. Returns the
 * transcript it wrote. */
export async function copyChatTranscript(
	repo: Repo,
	url: AutomergeUrl
): Promise<string> {
	const doc = (await repo.find<ChatDoc>(url)).doc()
	const text = formatTranscript(await resolveMessages(repo, doc), doc?.title)
	await writeToClipboard(text)
	return text
}

/** Render resolved messages as markdown: a header, then one section per
 * message with its attachments and any tool calls the computer made. */
export function formatTranscript(
	messages: ChatMessage[],
	title?: string
): string {
	const byId = new Map(
		messages.filter((m) => m.id).map((m) => [m.id, m] as const)
	)
	const parts = [
		"# " + (title || "Chat"),
		"",
		messages.length +
			(messages.length === 1 ? " message" : " messages") +
			", exported " +
			formatStamp(Date.now()) +
			".",
	]
	for (const msg of messages) {
		parts.push(
			"",
			"---",
			"",
			"**" + (msg.name || "unknown") + "** · " + formatStamp(msg.timestamp),
			"",
			messageBody(msg, byId)
		)
	}
	return parts.join("\n") + "\n"
}

async function resolveMessages(
	repo: Repo,
	doc: ChatDoc | undefined
): Promise<ChatMessage[]> {
	const messages: ChatMessage[] = []
	for (const entry of (doc?.messages ?? []) as any[]) {
		if (!entry) continue
		if (!entry.ref || !entry.url) {
			messages.push(entry as ChatMessage)
			continue
		}
		try {
			const msg = (await repo.find<ChatMessage>(entry.url)).doc()
			messages.push(msg ?? missingMessage(entry.timestamp))
		} catch {
			// A message doc that hasn't synced to this peer — keep its slot so
			// the transcript doesn't silently close a gap in the conversation.
			messages.push(missingMessage(entry.timestamp))
		}
	}
	return messages
}

function missingMessage(timestamp?: number): ChatMessage {
	return {
		id: "",
		name: "unknown",
		text: "[message not available on this device]",
		timestamp: timestamp || 0,
	}
}

function messageBody(msg: ChatMessage, byId: Map<string, ChatMessage>): string {
	const blocks: string[] = []
	const parent = msg.replyTo ? byId.get(msg.replyTo) : undefined
	if (parent) {
		blocks.push(
			"> in reply to **" +
				(parent.name || "unknown") +
				"**: " +
				oneLine(parent.text)
		)
	}
	if (msg.text?.trim()) blocks.push(msg.text.trim())
	const attachments = attachmentLines(msg)
	if (attachments.length) blocks.push(attachments.join("\n"))
	for (const block of msg.richBlocks ?? []) {
		const kind = block.type || "block"
		blocks.push(
			fence(kind, [block.meta, block.content].filter(Boolean).join("\n"))
		)
		if (block.result) blocks.push(fence(kind + "-result", block.result))
	}
	return blocks.join("\n\n") || "_(no text)_"
}

function attachmentLines(msg: ChatMessage): string[] {
	const lines: string[] = []
	if (msg.imageUrl) {
		lines.push("[image: " + (msg.imageName || "image") + " " + msg.imageUrl + "]")
	}
	if (msg.voiceUrl) {
		const length = msg.voiceDuration
			? " " + Math.round(msg.voiceDuration) + "s"
			: ""
		lines.push("[voice note" + length + " " + msg.voiceUrl + "]")
	}
	if (msg.gifSelfieUrl) lines.push("[gif selfie " + msg.gifSelfieUrl + "]")
	for (const file of msg.files ?? []) {
		lines.push("[file: " + file.name + " " + file.url + "]")
	}
	for (const embed of msg.embeds ?? []) {
		lines.push(
			"[document: " +
				(embed.title || embed.type || "document") +
				" " +
				embed.docUrl +
				"]"
		)
	}
	if (msg.quickReplies?.length) {
		lines.push("[suggested replies: " + msg.quickReplies.join(" / ") + "]")
	}
	return lines
}

/** A code fence long enough to survive backticks in the body. */
function fence(language: string, body: string): string {
	let longest = 0
	for (const run of body.match(/`+/g) ?? []) {
		longest = Math.max(longest, run.length)
	}
	const ticks = "`".repeat(Math.max(3, longest + 1))
	return ticks + language + "\n" + body + "\n" + ticks
}

function oneLine(text: string, max = 100): string {
	const flat = (text || "").replace(/\s+/g, " ").trim()
	return flat.length > max ? flat.slice(0, max - 1) + "…" : flat
}

function formatStamp(timestamp: number): string {
	if (!timestamp) return "unknown time"
	return new Date(timestamp).toLocaleString([], {
		dateStyle: "medium",
		timeStyle: "short",
	})
}

async function writeToClipboard(text: string) {
	try {
		await navigator.clipboard.writeText(text)
		return
	} catch {}
	// execCommand still works where the async clipboard API is blocked (an
	// insecure origin, or a permission the host hasn't granted the view).
	const scratch = document.createElement("textarea")
	scratch.value = text
	scratch.style.cssText = "position:fixed;top:0;left:0;opacity:0"
	document.body.append(scratch)
	scratch.select()
	try {
		if (!document.execCommand("copy")) throw new Error("copy rejected")
	} finally {
		scratch.remove()
	}
}
