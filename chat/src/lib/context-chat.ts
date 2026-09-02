// Shared plumbing for the context-tool chat variants (watercooler, agent): the
// per-account remembered default plugin set (kept in the `patchwork:tool-storage`
// doc) and the recipe for creating a chat doc that talks about a focused
// document.
import type {Repo, DocHandle} from "@automerge/automerge-repo/slim"
import type {ChatDoc} from "../types"

export type ToolStorageDoc = {
	defaultPlugins?: string[]
}

export const DEFAULT_CONTEXT_CHAT_PLUGINS = ["computer", "model"]
const OLD_DEFAULT_CONTEXT_CHAT_PLUGINS = ["computer"]

export function isOldDefaultContextChatPlugins(
	plugins: unknown
): plugins is string[] {
	return (
		Array.isArray(plugins) &&
		plugins.length === OLD_DEFAULT_CONTEXT_CHAT_PLUGINS.length &&
		plugins.every((p, i) => p === OLD_DEFAULT_CONTEXT_CHAT_PLUGINS[i])
	)
}

/** Initialise (or migrate) the tool-storage doc's remembered default plugin
 * set for new context chats. */
export function ensureDefaultPlugins(storage: DocHandle<ToolStorageDoc>) {
	if (!Array.isArray(storage.doc()?.defaultPlugins)) {
		storage.change((d) => {
			if (!Array.isArray(d.defaultPlugins))
				d.defaultPlugins = DEFAULT_CONTEXT_CHAT_PLUGINS.slice()
		})
	} else if (isOldDefaultContextChatPlugins(storage.doc()?.defaultPlugins)) {
		storage.change((d) => {
			if (isOldDefaultContextChatPlugins(d.defaultPlugins))
				d.defaultPlugins = DEFAULT_CONTEXT_CHAT_PLUGINS.slice()
		})
	}
}

/** Mirror a chat's current plugin set back to storage as the remembered
 * default for future context chats (no-op when unchanged). */
export function rememberPluginsAsDefault(
	chat: DocHandle<ChatDoc>,
	storage: DocHandle<ToolStorageDoc>
) {
	const plugins = (chat.doc() as any)?.plugins
	if (!Array.isArray(plugins)) return
	const current = storage.doc()?.defaultPlugins
	if (
		Array.isArray(current) &&
		current.length === plugins.length &&
		current.every((p, i) => p === plugins[i])
	)
		return
	storage.change((d) => {
		d.defaultPlugins = plugins.slice()
	})
}

/** Create a context chat doc: the computer auto-invited (ChatRoot's onMount
 * claims the host when `hasComputer` is set — but it stays off nosey, so it
 * only replies when @mentioned or replied to) and the plugin set seeded from
 * the remembered default. `datatype` is the `@patchwork.type` stamp: `chat`
 * for the watercooler (whose chitchat deliberately forks per draft),
 * `agent-chat` for the agent tool (on the drafts skip-list, so the
 * conversation never forks). Resolved through find so a non-skipped type
 * created on a draft forks into the draft's clones. */
export async function createContextChat(
	repo: Repo,
	title: string,
	defaultPlugins: string[],
	datatype = "chat"
): Promise<DocHandle<ChatDoc>> {
	const created = await repo.create2({
		title,
		messages: [],
		docs: [],
		plugins: defaultPlugins.slice(),
		"@patchwork": {type: datatype},
		hasComputer: true,
	} as any)
	return (await repo.find(created.url)) as DocHandle<ChatDoc>
}
