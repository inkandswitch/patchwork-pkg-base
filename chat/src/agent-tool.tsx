// The "Agent" context-tool — the watercooler's multi-chat sibling. Where the
// watercooler stores ONE chat url at focusedDoc['@patchwork'].chitchat, this
// keeps a LIST of chats with a tab bar on top to switch between them, create
// new ones, and rename them. A tab's name IS the chat doc's title (rename
// writes doc.title, same as the datatype's setTitle), and each tab's
// conversation is the ordinary ChatRoot in context mode — same chat UI, same
// computer, just wrapped.
//
// STORAGE — everything branch-independent lives OFF the focused doc, because
// the focused doc forks per draft:
//   - The chat list lives in a separate `agent-chats` index doc; the focused
//     doc carries only a write-once pointer (`@patchwork.agentChats`), read
//     and written through the RAW `window.repo` so it always hits the real
//     doc whatever branch is checked out.
//   - Chat docs (and their message docs) are the `agent-chat` datatype. Both
//     types are on the drafts skip-list, so the overlay never forks them —
//     tabs and conversations are identical on every branch.
//
// DRAFTS — the computer's edits land on a per-chat draft (reusing the drafts
// plugin's machinery, see lib/agent-drafts.ts): when a run starts, the chat's
// draft is created (first run) or reused and checked out, so the overlay
// routes the run's edits into it; when a run that edited docs finishes, a
// draft-review embed (accept/reject) is posted into the conversation.
// Selecting a tab checks out the draft its agent is working on.
//
// Every tab's ChatRoot stays MOUNTED while another tab is showing (inactive
// panes are hidden with CSS, not unmounted), so each chat's computer keeps
// running in the background: in-flight responses keep streaming and its host
// keeps listening for new mentions.
import {render} from "solid-js/web"
import {
	createSignal,
	createEffect,
	createMemo,
	onCleanup,
	Show,
	For,
} from "solid-js"
import {isValidAutomergeUrl} from "@automerge/automerge-repo/slim"
import type {Repo, DocHandle, AutomergeUrl} from "@automerge/automerge-repo/slim"
import {ChatRoot} from "./components/ChatRoot"
import {CHAT_VERSION} from "./version"
import {selectedDocUrl, toolStorageUrl} from "./lib/selected-doc"
import {setRepo} from "./lib/repo"
import {generateId} from "./lib/helpers"
import {
	DEFAULT_CONTEXT_CHAT_PLUGINS,
	ensureDefaultPlugins,
	rememberPluginsAsDefault,
	createContextChat,
	type ToolStorageDoc,
} from "./lib/context-chat"
import {
	AGENT_CHAT_TYPE,
	rawRepo,
	resolveAgentChatsIndex,
	createAgentDraft,
	checkedOutDraftHandle,
	checkoutDraft,
	checkoutAgentDraft,
	resolveInDraft,
	type AgentChatsIndexDoc,
	type CheckedOutDraft,
	type DraftDoc,
} from "./lib/agent-drafts"
import type {ChatDoc} from "./types"

/** patchwork:component render: `(element) => cleanup`. */
export function AgentContextComponent(element: HTMLElement) {
	const repo: Repo = (element as any).repo || (window as any).repo
	setRepo(repo)

	if (getComputedStyle(element).position === "static") {
		element.style.position = "relative"
	}

	const dispose = render(
		() => <AgentHost element={element} repo={repo} />,
		element
	)
	return () => dispose()
}

function AgentHost(props: {element: HTMLElement; repo: Repo}) {
	const targetUrl = selectedDocUrl(props.element)

	// The ephemeral checked-out doc (the drafts machinery's selection) — one
	// subscription shared by every pane and review embed under this tool.
	const checkedOut = checkedOutDraftHandle(props.element)

	// Resolve the focused doc's agent-chats index (creating it on first use)
	// through the RAW repo — the pointer on the focused doc and the index doc
	// itself are branch-independent.
	const [indexHandle, setIndexHandle] =
		createSignal<DocHandle<AgentChatsIndexDoc> | null>(null)
	const [activeUrl, setActiveUrl] = createSignal<AutomergeUrl | null>(null)
	createEffect(() => {
		const url = targetUrl()
		setIndexHandle(null)
		setActiveUrl(null)
		if (!url) return
		let stale = false
		resolveAgentChatsIndex(rawRepo(), url)
			.then((h) => {
				if (!stale && targetUrl() === url) setIndexHandle(h)
			})
			.catch((e) => console.warn("[agent] chat index:", e))
		onCleanup(() => {
			stale = true
		})
	})

	// Mirror the index doc into a signal so the tab list stays live (local and
	// remote edits alike).
	const [indexDoc, setIndexDoc] = createSignal<AgentChatsIndexDoc | undefined>(
		undefined
	)
	createEffect(() => {
		const h = indexHandle()
		if (!h) {
			setIndexDoc(undefined)
			return
		}
		const update = () => setIndexDoc(() => h.doc())
		update()
		h.on("change", update)
		onCleanup(() => h.off("change", update))
	})

	const chats = createMemo<AutomergeUrl[]>(() => {
		const list = indexDoc()?.chats
		return Array.isArray(list) ? [...list] : []
	})

	// Default plugin set for NEW chats — shared with the watercooler via the
	// same `chitchat` tool-storage doc, so both remember the same last-used set.
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
			.catch((e) => console.warn("[agent] tool-storage:", e))
	})
	const defaultPlugins = () =>
		storageHandle()?.doc()?.defaultPlugins ?? DEFAULT_CONTEXT_CHAT_PLUGINS

	/** Create a chat, link it into the index doc, and switch to it. */
	const addChat = async () => {
		const index = indexHandle()
		const url = targetUrl()
		if (!index || !url) return
		try {
			const chat = await createContextChat(
				props.repo,
				"Chat " + (chats().length + 1),
				defaultPlugins(),
				AGENT_CHAT_TYPE
			)
			index.change((d) => {
				if (!Array.isArray(d.chats)) d.chats = []
				d.chats.push(chat.url)
			})
			// Only steal the active tab if the user is still on the same doc.
			if (targetUrl() === url) setActiveUrl(chat.url)
		} catch (e) {
			console.warn("[agent] create chat:", e)
		}
	}

	// A doc focused for the first time gets its first chat automatically (like
	// the watercooler). Guarded per-url so a slow create doesn't loop.
	let autoCreatedFor: string | null = null
	createEffect(() => {
		const index = indexHandle()
		const url = targetUrl()
		if (!index || !url) return
		if (chats().length > 0) return
		if (autoCreatedFor === url) return
		autoCreatedFor = url
		addChat()
	})

	// The active tab: the explicit selection while it's still in the list, else
	// the first chat.
	const effectiveActiveUrl = createMemo(() => {
		const list = chats()
		const a = activeUrl()
		return a && list.includes(a) ? a : list[0]
	})

	return (
		<div class="agent-root">
			<Show
				when={targetUrl()}
				fallback={
					<div class="chat-context-empty">
						Select a document to chat about it.
					</div>
				}>
				<div class="agent-tabs" role="tablist">
					<For each={chats()}>
						{(url) => (
							<ChatTab
								repo={props.repo}
								url={url}
								active={url === effectiveActiveUrl()}
								onSelect={() => setActiveUrl(url)}
							/>
						)}
					</For>
					<button
						class="agent-tab-new"
						title="New chat"
						aria-label="New chat"
						onClick={addChat}>
						+
					</button>
					<span class="agent-version" title="Chat bundle version">
						{CHAT_VERSION}
					</span>
				</div>
				<div class="agent-panes">
					<Show
						when={chats().length > 0}
						fallback={<div class="chat-context-empty">Loading chat…</div>}>
						<For each={chats()}>
							{(url) => (
								<ChatPane
									repo={props.repo}
									element={props.element}
									url={url}
									active={url === effectiveActiveUrl()}
									targetUrl={targetUrl}
									storageHandle={storageHandle}
									checkedOut={checkedOut}
								/>
							)}
						</For>
					</Show>
				</div>
			</Show>
		</div>
	)
}

/** One always-mounted chat pane. When its tab is inactive the pane is hidden
 * with CSS (visibility) rather than unmounted, so the chat's computer keeps
 * running: heartbeat, mention listener, and any in-flight response all stay
 * alive, and scroll position is preserved across tab switches.
 *
 * The pane also owns its chat's draft lifecycle: one open draft per chat
 * (`chatDoc.agentDraftUrl`), forked off the focused doc's main on the first
 * editing run, checked out for the duration of every run (and whenever this
 * tab is selected), and closed by the review embed's accept/reject. */
function ChatPane(props: {
	repo: Repo
	element: HTMLElement
	url: AutomergeUrl
	active: boolean
	targetUrl: () => AutomergeUrl | undefined
	storageHandle: () => DocHandle<ToolStorageDoc> | null
	checkedOut: () => DocHandle<CheckedOutDraft> | null
}) {
	const [handle, setHandle] = createSignal<DocHandle<ChatDoc> | null>(null)
	createEffect(() => {
		const url = props.url
		let stale = false
		props.repo
			.find(url)
			.then((h) => {
				if (!stale) setHandle(h as DocHandle<ChatDoc>)
			})
			.catch((e) => console.warn("[agent] find chat:", e))
		onCleanup(() => {
			stale = true
		})
	})

	// Live chat doc snapshot, for the open draft pointer.
	const [chatDoc, setChatDoc] = createSignal<any>(undefined)
	createEffect(() => {
		const h = handle()
		if (!h) {
			setChatDoc(undefined)
			return
		}
		const update = () => setChatDoc(() => h.doc())
		update()
		h.on("change", update)
		onCleanup(() => h.off("change", update))
	})
	const agentDraftUrl = createMemo<AutomergeUrl | null>(() => {
		const u = chatDoc()?.agentDraftUrl
		return typeof u === "string" && isValidAutomergeUrl(u) ? u : null
	})

	// Selecting a tab checks out the draft its agent is working on — with diff
	// baselines at the fork points, so the document view highlights what the
	// agent changed. A tab with NO open draft resets the view to main: a fresh
	// chat starts from a clean slate, and after accept/reject (which clears
	// the chat's draft pointer) this re-fires and lands on main. Waits for the
	// chat doc to load so an existing draft isn't mistaken for "no draft".
	// Not reactive to the checkout itself, so the user can still browse other
	// branches from the drafts sidebar without being yanked back mid-tab.
	const chatLoaded = createMemo(() => chatDoc() !== undefined)
	createEffect(() => {
		if (!props.active || !chatLoaded()) return
		const draft = agentDraftUrl()
		const co = props.checkedOut()
		if (!co) return
		if (!draft) {
			checkoutDraft(co, null)
			return
		}
		checkoutAgentDraft(rawRepo(), co, draft).catch((e) =>
			console.warn("[agent] tab checkout:", e)
		)
	})

	// Mirror last-used: while this pane is the active tab, remember its plugin
	// set as the default for future context chats.
	createEffect(() => {
		if (!props.active) return
		const chat = handle()
		const storage = props.storageHandle()
		if (!chat || !storage) return
		const write = () => rememberPluginsAsDefault(chat, storage)
		write()
		chat.on("change", write)
		onCleanup(() => chat.off("change", write))
	})

	/** The chat's open draft, creating (and recording) a fresh one when there
	 * is none yet or the last one was merged away. */
	const ensureRunDraft = async (): Promise<AutomergeUrl | null> => {
		const chat = handle()
		const turl = props.targetUrl()
		if (!chat || !turl) return null
		const repo = rawRepo()
		const existing = agentDraftUrl()
		if (existing) {
			try {
				const d = await repo.find<DraftDoc>(existing)
				if (d.doc()?.mergedAt === undefined) return existing
			} catch (e) {
				console.warn("[agent] stale draft pointer:", e)
			}
		}
		const name = (chat.doc() as any)?.title || "Agent chat"
		const draftUrl = await createAgentDraft(repo, turl, name)
		chat.change((d: any) => {
			d.agentDraftUrl = draftUrl
		})
		return draftUrl
	}

	// The draft the CURRENT run writes to, set by onRunStart. Run-time doc
	// resolution goes through resolveDoc below — aimed at this draft directly,
	// never via the global checkout — so switching tabs mid-run (or running
	// several chats in parallel) can't redirect in-flight edits.
	let runDraftUrl: AutomergeUrl | null = null

	const onRunStart = async () => {
		// No checked-out doc = no drafts machinery mounted; run plainly (edits
		// land on the real docs) rather than bookkeeping invisible drafts.
		if (!props.checkedOut()) {
			runDraftUrl = null
			return
		}
		runDraftUrl = await ensureRunDraft()
		// If this tab is the one being watched, the tab-select effect checks
		// the (possibly new) draft out for VIEWING — the run doesn't depend on
		// it. Background tabs leave the checkout entirely alone.
	}

	/** Run-path doc resolution: the chat's own draft clone when a draft run is
	 * open, else whatever the overlay repo decides (checked-out draft or
	 * main). Handed to ChatRoot for every read/edit during a computer run. */
	const resolveDoc = async (url: string) => {
		const draft = runDraftUrl
		if (!draft) return props.repo.find(url as AutomergeUrl)
		return resolveInDraft(rawRepo(), draft, url as AutomergeUrl)
	}

	const onRunEnd = async (edited: boolean, summary?: string) => {
		try {
			if (edited) {
				if (summary) await renameDraft(summary)
				await postDraftReview()
			}
		} catch (e) {
			console.warn("[agent] draft review embed:", e)
		}
		// If the user is watching this draft, refresh the checkout so the diff
		// baselines cover the docs that forked during this run.
		const co = props.checkedOut()
		if (edited && co) {
			const draft = agentDraftUrl()
			if (draft && (co.doc()?.checkedOut ?? null) === draft) {
				await checkoutAgentDraft(rawRepo(), co, draft)
			}
		}
	}

	/** Rename the chat's open draft (the LLM's change summary becomes the
	 * draft's name in the sidebar and the review embed). */
	const renameDraft = async (name: string) => {
		const draftUrl = agentDraftUrl()
		if (!draftUrl) return
		const draft = await rawRepo().find<DraftDoc>(draftUrl)
		draft.change((d) => {
			d.name = name
		})
	}

	/** Post the accept/reject review embed for the chat's open draft. */
	const postDraftReview = async () => {
		const chat = handle()
		const draftUrl = agentDraftUrl()
		if (!chat || !draftUrl) return
		const repo = rawRepo()
		let name = "Draft"
		try {
			name = (await repo.find<DraftDoc>(draftUrl)).doc()?.name || name
		} catch {}
		const msgData = {
			id: generateId(),
			name: "computer",
			text: `I made my changes on the draft “${name}” — review them below.`,
			timestamp: Date.now(),
			isComputer: true,
			font: "monospace",
			richBlocks: [{type: "draft-review", content: draftUrl, meta: name}],
			"@patchwork": {type: AGENT_CHAT_TYPE},
		}
		const mh = await repo.create2(msgData as any)
		chat.change((d: any) => {
			if (!d.messages) d.messages = []
			d.messages.push({ref: true, url: mh.url, timestamp: msgData.timestamp})
		})
	}

	return (
		<div class="agent-pane" data-selected={props.active ? "" : undefined}>
			<Show
				when={handle()}
				keyed
				fallback={<div class="chat-context-empty">Loading chat…</div>}>
				{(h) => (
					<ChatRoot
						handle={h}
						element={props.element}
						mode="context"
						targetDocUrl={props.targetUrl}
						agentDraft={{onRunStart, onRunEnd, resolveDoc}}
					/>
				)}
			</Show>
		</div>
	)
}

/** One tab. Its label is the chat doc's live title; double-click to rename
 * (the new name is written onto the chat doc itself). */
function ChatTab(props: {
	repo: Repo
	url: AutomergeUrl
	active: boolean
	onSelect: () => void
}) {
	const [handle, setHandle] = createSignal<DocHandle<ChatDoc> | null>(null)
	const [title, setTitle] = createSignal("…")
	const [editing, setEditing] = createSignal(false)

	createEffect(() => {
		const url = props.url
		let stale = false
		let found: DocHandle<ChatDoc> | null = null
		const update = () => {
			if (found) setTitle((found.doc() as any)?.title || "chat")
		}
		props.repo
			.find(url)
			.then((h) => {
				if (stale) return
				found = h as DocHandle<ChatDoc>
				setHandle(found)
				update()
				found.on("change", update)
			})
			.catch(() => setTitle("?"))
		onCleanup(() => {
			stale = true
			found?.off("change", update)
		})
	})

	const commitRename = (value: string) => {
		if (!editing()) return
		setEditing(false)
		const name = value.trim()
		const h = handle()
		if (!name || !h || name === title()) return
		h.change((d) => {
			d.title = name
		})
	}

	return (
		<Show
			when={!editing()}
			fallback={
				<input
					class="agent-tab-rename"
					value={title()}
					ref={(el) =>
						queueMicrotask(() => {
							el.focus()
							el.select()
						})
					}
					onKeyDown={(e) => {
						if (e.key === "Enter") commitRename(e.currentTarget.value)
						else if (e.key === "Escape") setEditing(false)
					}}
					onBlur={(e) => commitRename(e.currentTarget.value)}
				/>
			}>
			<button
				class="agent-tab"
				role="tab"
				aria-selected={props.active}
				data-selected={props.active ? "" : undefined}
				title={title() + " — double-click to rename"}
				onClick={props.onSelect}
				onDblClick={() => setEditing(true)}>
				{title()}
			</button>
		</Show>
	)
}
