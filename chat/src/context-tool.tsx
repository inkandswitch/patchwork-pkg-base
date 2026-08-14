// The `context-tool` variant of chitterchatter — the "chitchat" sidebar.
//
// Registered as a `patchwork:component` (render signature `(element) => cleanup`,
// no bound doc). It reads whatever document the user has FOCUSED from the
// selected-doc provider, stores its chat in a separate doc referenced from
// `focusedDoc['@patchwork'].chitchat` (created on first use), and renders the
// chat UI — streamlined (no sidebar) and with the computer pointed at editing
// the focused document instead of building tools.
//
// The set of plugins a *new* chitchat starts with is remembered per-account via
// the `patchwork:tool-storage` provider (`{defaultPlugins}`, initialised to just
// `["computer"]`). Whenever a chitchat's plugin set changes (e.g. via `/plugin`),
// that new set is written back as the remembered default for future chitchats.
import {render} from "solid-js/web"
import {createSignal, createEffect, onCleanup, Show} from "solid-js"
import type {Repo, DocHandle, AutomergeUrl} from "@automerge/automerge-repo/slim"
import {ChatRoot} from "./components/ChatRoot"
import {selectedDocUrl, toolStorageUrl} from "./lib/selected-doc"
import {setRepo} from "./lib/repo"
import {
	DEFAULT_CONTEXT_CHAT_PLUGINS,
	isOldDefaultContextChatPlugins,
	ensureDefaultPlugins,
	rememberPluginsAsDefault,
	createContextChat,
	type ToolStorageDoc,
} from "./lib/context-chat"
import type {ChatDoc} from "./types"

/** Find (or create + link) the chat doc stored on the focused document, seeding a
 * new one's plugin set from the remembered default. */
async function ensureChitchat(
	repo: Repo,
	targetUrl: AutomergeUrl,
	defaultPlugins: string[]
): Promise<DocHandle<ChatDoc>> {
	const target = await repo.find(targetUrl)
	const existing = (target.doc() as any)?.["@patchwork"]?.chitchat
	if (existing) {
		const chat = (await repo.find(existing)) as DocHandle<ChatDoc>
		chat.change((d: any) => {
			const isMissingPlugins = !Array.isArray(d.plugins)
			if (isMissingPlugins) d.plugins = defaultPlugins.slice()
			else if (isOldDefaultContextChatPlugins(d.plugins)) {
				d.plugins = DEFAULT_CONTEXT_CHAT_PLUGINS.slice()
			}
			if (isMissingPlugins && d["@patchwork"]?.type === "chitterchatter") {
				d["@patchwork"].type = "chat"
			}
		})
		return chat
	}

	const targetTitle = (target.doc() as any)?.title
	const chat = await createContextChat(
		repo,
		"chat: " + (targetTitle || "document"),
		defaultPlugins
	)
	target.change((d: any) => {
		if (!d["@patchwork"]) d["@patchwork"] = {}
		d["@patchwork"].chitchat = chat.url
	})
	return chat
}

function ContextHost(props: {element: HTMLElement; repo: Repo}) {
	const targetUrl = selectedDocUrl(props.element)
	const [chatHandle, setChatHandle] = createSignal<DocHandle<ChatDoc> | null>(
		null
	)
	let ensuringFor: string | null = null

	// The account-scoped tool-storage doc that remembers the user's default
	// chitchat plugin set. Resolve its handle; ensure it has `defaultPlugins`.
	const storageUrl = toolStorageUrl(props.element, "chitchat")
	const [storageHandle, setStorageHandle] =
		createSignal<DocHandle<ToolStorageDoc> | null>(null)
	createEffect(() => {
		const url = storageUrl()
		if (!url) return
		props.repo
			.find(url)
			.then((h) => {
				const storage = h as DocHandle<ToolStorageDoc>
				ensureDefaultPlugins(storage)
				setStorageHandle(storage)
			})
			.catch((e) => console.warn("[chitchat] tool-storage:", e))
	})
	const defaultPlugins = () =>
		storageHandle()?.doc()?.defaultPlugins ?? DEFAULT_CONTEXT_CHAT_PLUGINS

	createEffect(() => {
		const url = targetUrl()
		if (!url) {
			ensuringFor = null
			setChatHandle(null)
			return
		}
		if (ensuringFor === url) return
		ensuringFor = url
		setChatHandle(null)
		ensureChitchat(props.repo, url, defaultPlugins())
			.then((h) => {
				// Ignore if the selection moved on while we were resolving.
				if (targetUrl() === url) setChatHandle(h)
			})
			.catch((e) => console.warn("[chitterchatter:context] ensureChitchat", e))
	})

	// Mirror last-used: when the active chitchat's plugin set changes, remember it
	// as the default for future chitchats.
	createEffect(() => {
		const chat = chatHandle()
		const storage = storageHandle()
		if (!chat || !storage) return
		const write = () => rememberPluginsAsDefault(chat, storage)
		write()
		chat.on("change", write)
		onCleanup(() => chat.off("change", write))
	})

	return (
		<Show
			when={chatHandle()}
			keyed
			fallback={
				<div class="chat-context-empty">
					{targetUrl()
						? "Loading chat…"
						: "Select a document to chat about it."}
				</div>
			}>
			{(handle) => (
				<ChatRoot
					handle={handle}
					element={props.element}
					mode="context"
					targetDocUrl={targetUrl}
				/>
			)}
		</Show>
	)
}

/** patchwork:component render: `(element) => cleanup`. */
export function ChatContextComponent(element: HTMLElement) {
	const repo: Repo = (element as any).repo || (window as any).repo
	setRepo(repo)

	if (getComputedStyle(element).position === "static") {
		element.style.position = "relative"
	}

	const dispose = render(
		() => <ContextHost element={element} repo={repo} />,
		element
	)
	return () => dispose()
}
