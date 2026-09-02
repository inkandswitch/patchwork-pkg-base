// Agent-attributed writes: every document edit the agent makes on the user's
// behalf goes through `agentChange`, which stamps the Automerge change's
// `message` with a JSON tag naming the chat (and its heads at execution time,
// so the tag deep-links to the conversation state that produced the edit).
// The message travels with the change itself — through draft clones, merges,
// and sync — so any consumer (the drafts timeline splits change groups on it
// and shows a "via agent" badge) can tell agent edits from the same person's
// manual ones without a side channel.
//
// The tag is an envelope under "@patchwork" so other tools can add their own
// change metadata later without colliding. Consumers must parse defensively:
// a change message is free text to Automerge, so anything non-JSON (or JSON
// of another shape) simply means "not an agent edit".
//
// Known gap: custom tools minted via define_tool call ctx.handle.change
// themselves and their edits stay untagged for now.
import type {DocHandle, AutomergeUrl, UrlHeads} from "@automerge/automerge-repo/slim"

export type AgentChangeTag = {
	"@patchwork": {
		agent: {
			/** The agent chat doc the edit came from. */
			chatUrl: AutomergeUrl
			/** The chat's heads when the tool call executed. */
			chatHeads?: string[]
			/** Provider tool-call id, when the provider supplies one. */
			toolCallId?: string
		}
	}
}

export function makeAgentTag(
	chatHandle: DocHandle<unknown>,
	toolCallId?: string
): AgentChangeTag {
	const agent: AgentChangeTag["@patchwork"]["agent"] = {
		chatUrl: chatHandle.url,
	}
	const heads = headsOf(chatHandle)
	if (heads) agent.chatHeads = heads
	if (toolCallId) agent.toolCallId = toolCallId
	return {"@patchwork": {agent}}
}

/** `handle.change` / `handle.changeAt` with the agent tag as the change
 * message. Use for every agent edit to a target document (not for the chat
 * doc's own message writes — those aren't document edits). */
export function agentChange<T>(
	handle: DocHandle<T>,
	tag: AgentChangeTag,
	mut: (doc: T) => void,
	heads?: UrlHeads
): void {
	const options = {message: JSON.stringify(tag)}
	console.log(
		"[agent-change] tagging",
		heads && heads.length ? "changeAt" : "change",
		"on",
		handle.url,
		"message:",
		options.message
	)
	if (heads && heads.length) {
		handle.changeAt(heads, mut, options)
	} else {
		handle.change(mut, options)
	}
}

function headsOf(handle: DocHandle<unknown>): string[] | undefined {
	try {
		const heads = handle.heads()
		return heads && heads.length ? [...heads] : undefined
	} catch {
		return undefined
	}
}
