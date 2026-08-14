import {featureDescriptions} from "./features"
import {syntaxPluginDescriptions} from "./lib/syntax"
import {slashPluginDescriptions} from "./lib/slash-plugins"
import {messageActionDescriptions} from "./lib/message-actions"
import {emojiPackDescriptions} from "./lib/emoji-packs"

export const plugins = [
	{
		// The "Chat" preset: seeds just the computer. Grows via `/plugin load` or by
		// loading the chitter bundle. `chat` is also the legacy datatype id. The
		// "everything" preset now lives in the chitter bundle (the `chitter`
		// datatype); the base tool still RENDERS `chitterchatter`/`chitter` docs via
		// `supportedDatatypes`, and chitter registers those datatypes' presets.
		type: "patchwork:datatype",
		id: "chat",
		name: "Chat",
		icon: "MessageSquare",
		async load() {
			return (await import("./datatype")).ChatDatatype
		},
	},
	{
		// The Agent tool's chats: identical to `chat`, but a distinct type the
		// drafts overlay skips (never forks) — the conversation must survive a
		// rejected draft. Unlisted: created by the Agent tool, not by hand.
		type: "patchwork:datatype",
		id: "agent-chat",
		name: "Agent Chat",
		icon: "Bot",
		unlisted: true,
		async load() {
			return (await import("./datatype")).AgentChatDatatype
		},
	},
	{
		// The single chat tool. Which features are active is driven by the
		// document's `plugins` array, not by the tool. Registered under `chat`;
		// a `chitterchatter` alias below keeps existing pins/toolIds resolving.
		type: "patchwork:tool",
		id: "chat",
		name: "Chat",
		icon: "MessageSquare",
		supportedDatatypes: ["chitterchatter", "chat", "chitter", "agent-chat"],
		async load() {
			return (await import("./tool")).ChatTool
		},
	},
	{
		// Host-embeddable component (<patchwork-view component="chat">). Defaults to
		// the minimal feature set; features="full" for everything.
		type: "patchwork:component",
		id: "chat",
		name: "Chat",
		icon: "MessageSquare",
		async load() {
			return (await import("./tool")).ChatComponent
		},
	},
	{
		// Streamlined context-sidebar variant: no sidebar, chats about whatever
		// document is focused (chat stored at focusedDoc['@patchwork'].chitchat),
		// and the computer edits that document via universal Automerge ops.
		type: "patchwork:component",
		id: "watercooler",
		name: "Watercooler",
		icon: "MessageCircle",
		tags: ["context-tool"],
		async load() {
			const {ChatContextComponent} = await import("./context-tool")
			return ChatContextComponent
		},
	},
	{
		// Multi-chat context-sidebar variant: like the watercooler, but with a
		// tab bar of chats per focused document (the list lives in a separate,
		// never-forked `agent-chats` index doc the focused doc points at), and
		// the computer's edits land on a per-chat draft with an accept/reject
		// review embed in the conversation.
		type: "patchwork:component",
		id: "agent",
		name: "Agent",
		icon: "Bot",
		tags: ["context-tool"],
		async load() {
			const {AgentContextComponent} = await import("./agent-tool")
			return AgentContextComponent
		},
	},
	// ── Host-registrable feature plugins ────────────────────────────────────────
	// The four extensible seams, registered like newspace's sketchy:* plugins so
	// other modules can contribute inline syntax, slash commands, hover actions and
	// emoji packs. The tool also keeps these as built-in fallbacks (see lib/*),
	// so it works even if the registry is empty.
	//
	// These MUST be serializable: the host reads `plugins` in a worker and clones
	// each entry to the main thread (excluding `load`). `feature`/`parser-extension`
	// entries are pure data (RegExp is cloneable) and spread raw; `slash`,
	// `messageaction` and `emojipack` carry function fields, so they're registered
	// as descriptions with the fancy code behind `async load()`.
	...featureDescriptions,
	...syntaxPluginDescriptions,
	...slashPluginDescriptions,
	...messageActionDescriptions,
	...emojiPackDescriptions,
]
