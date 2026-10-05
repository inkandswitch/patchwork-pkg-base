import type {AutomergeUrl} from "@automerge/automerge-repo/slim"
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
// `/plugin load` (or by loading the `chitter` bundle). The "everything" preset is
// the chitter bundle's `chitter` datatype.
export const ChatDatatype = {
	init(doc: ChatDoc) {
		base(doc, "chat " + new Date().toLocaleString(), ["computer", "model"])
	},
	getTitle,
	setTitle,
	getEmbeddedDocuments,
}

// The docs a new draft forks along with the chat: split-out messages, their
// attachments and embeds, and the pinned docs. Not the emoticon and font
// libraries or the senders' avatars and contacts, which are shared, nor a pin's
// `copyOf`, which points back at where it came from.
function getEmbeddedDocuments(doc: ChatDoc): AutomergeUrl[] {
	const urls: (AutomergeUrl | undefined)[] = []
	for (const message of doc.messages ?? []) {
		if ("ref" in message) {
			urls.push(message.url)
			continue
		}
		urls.push(message.imageUrl, message.voiceUrl, message.gifSelfieUrl)
		for (const file of message.files ?? []) urls.push(file.url)
		for (const embed of message.embeds ?? []) urls.push(embed.docUrl)
	}
	for (const link of doc.docs ?? []) urls.push(link.url)
	return urls.filter((url): url is AutomergeUrl => !!url)
}
