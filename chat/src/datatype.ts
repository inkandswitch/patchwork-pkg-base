import type {ChatDoc} from "./types"

// Shared skeleton. `plugins` decides which full-tier features are active.
function base(doc: ChatDoc, title: string, plugins: string[]) {
	doc.title = title
	doc.messages = []
	doc.docs = []
	doc.plugins = plugins
}

const getTitle = (doc: ChatDoc) => doc.title || "chat"
const setTitle = (doc: ChatDoc, title: string) => {
	doc.title = title
}

// `chat` — the base preset: just the computer. A plain chat that grows itself via
// `/plugin load` (or by loading the `chitter` bundle). The "everything" preset now
// lives in the chitter bundle as the `chitter` datatype.
export const ChatDatatype = {
	init(doc: ChatDoc) {
		base(doc, "chat " + new Date().toLocaleString(), ["computer", "model"])
	},
	getTitle,
	setTitle,
}

// `agent-chat` — the Agent context-tool's chats. Same document shape and same
// chat tool as `chat`; the distinct type exists so the drafts overlay can skip
// (never fork) these docs — see lib/agent-drafts.ts.
export const AgentChatDatatype = {
	init(doc: ChatDoc) {
		base(doc, "agent chat " + new Date().toLocaleString(), [
			"computer",
			"model",
		])
	},
	getTitle,
	setTitle,
}
