import {createSignal, createResource, For, Show} from "solid-js"
import {isValidAutomergeUrl} from "@automerge/automerge-repo/slim"
import type {AutomergeUrl} from "@automerge/automerge-repo/slim"
import type {RichBlock} from "../types"
import {highlightCode} from "../lib/highlighter"
import {useTheme} from "../context/ThemeContext"
import {useChat} from "../context/ChatContext"
import {
	rawRepo,
	mergeAgentDraft,
	rejectAgentDraft,
	checkedOutDraftHandle,
	checkoutDraft,
} from "../lib/agent-drafts"

export function RichBlockList(props: {
	blocks: RichBlock[]
	// The message doc these blocks live on — lets stateful blocks (the agent
	// draft review) record their outcome back onto the block.
	messageUrl?: AutomergeUrl
}) {
	return (
		<div class="chat-rich-blocks">
			<For each={props.blocks}>
				{(block) => (
					<Show
						when={block.type === "draft-review"}
						fallback={<RichBlockView block={block} />}>
						<DraftReviewBlock block={block} messageUrl={props.messageUrl} />
					</Show>
				)}
			</For>
		</div>
	)
}

/** The agent-draft review embed: names the draft the computer's edits landed
 * on, with Accept (merge it into what it branched off, then check that out)
 * and Reject (delete the draft, back to main) — both through the existing
 * drafts machinery (see lib/agent-drafts.ts). The decision is recorded on the
 * block's `result` ("accepted"/"rejected"), which syncs to every peer and
 * freezes the embed; embeds from earlier runs on the same draft freeze as
 * "closed" once the draft is no longer the chat's open one. */
function DraftReviewBlock(props: {
	block: RichBlock
	messageUrl?: AutomergeUrl
}) {
	const {handle, doc, element} = useChat()
	const checkedOut = checkedOutDraftHandle(element)
	const [busy, setBusy] = createSignal(false)

	const draftUrl = (): AutomergeUrl | null =>
		isValidAutomergeUrl(props.block.content) ? props.block.content : null
	const decided = () => props.block.result
	// Only the chat's currently-open draft is actionable.
	const open = () =>
		!!draftUrl() && (doc() as any)?.agentDraftUrl === draftUrl()

	async function decide(action: "accept" | "reject") {
		const url = draftUrl()
		if (!url || busy() || decided() || !open()) return
		setBusy(true)
		try {
			const repo = rawRepo()
			if (action === "accept") await mergeAgentDraft(repo, url)
			else await rejectAgentDraft(repo, url)
			// Accept or reject, the story ends on main: merged changes are
			// there now, rejected ones are gone.
			const co = checkedOut()
			if (co) checkoutDraft(co, null)
			// Close the chat's open draft; the next run forks a fresh one.
			handle.change((d: any) => {
				if (d.agentDraftUrl === url) delete d.agentDraftUrl
			})
			// Freeze this embed for every peer.
			if (props.messageUrl) {
				const mh = await repo.find<{richBlocks?: RichBlock[]}>(
					props.messageUrl
				)
				mh.change((d) => {
					const block = (d.richBlocks || []).find(
						(b) =>
							b.type === "draft-review" && b.content === url && !b.result
					)
					if (block)
						block.result = action === "accept" ? "accepted" : "rejected"
				})
			}
		} catch (e) {
			console.warn("[agent] draft " + action + " failed:", e)
		} finally {
			setBusy(false)
		}
	}

	return (
		<div
			class="chat-draft-review"
			data-state={decided() || (open() ? "open" : "closed")}>
			<svg
				class="chat-draft-review-icon"
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round">
				<line x1="6" x2="6" y1="3" y2="15" />
				<circle cx="18" cy="6" r="3" />
				<circle cx="6" cy="18" r="3" />
				<path d="M18 9a9 9 0 0 1-9 9" />
			</svg>
			<span class="chat-draft-review-name">
				{props.block.meta || "Draft"}
			</span>
			<Show
				when={!decided() && open()}
				fallback={
					<span class="chat-draft-review-state">
						{decided() === "accepted"
							? "Accepted"
							: decided() === "rejected"
								? "Rejected"
								: "Closed"}
					</span>
				}>
				<span class="chat-draft-review-actions">
					<button
						class="chat-draft-review-btn chat-draft-review-accept"
						disabled={busy()}
						on:click={() => decide("accept")}>
						Accept
					</button>
					<button
						class="chat-draft-review-btn chat-draft-review-reject"
						disabled={busy()}
						on:click={() => decide("reject")}>
						Reject
					</button>
				</span>
			</Show>
		</div>
	)
}

function RichBlockView(props: {block: RichBlock}) {
	const {isLightBg} = useTheme()
	const [open, setOpen] = createSignal(false)

	const label = () => {
		if (props.block.type === "tool-call") {
			const firstLine = props.block.content.trim().split("\n")[0]
			const toolMatch = firstLine.match(/^tool:\s*(.+)/)
			return toolMatch ? "tool: " + toolMatch[1] : "tool-call"
		}
		if (props.block.type === "patchwork-tool") {
			return "patchwork-tool"
		}
		return props.block.type
	}

	const lang = () => {
		if (props.block.type === "patchwork-tool") return "javascript"
		if (props.block.type === "tool-call") return "yaml"
		return "text"
	}

	const [highlighted] = createResource(
		() => ({content: props.block.content, lang: lang(), light: isLightBg()}),
		async ({content, lang, light}) => highlightCode(content.trim(), lang, light)
	)

	const [resultHighlighted] = createResource(
		() => props.block.result ? {content: props.block.result, lang: "json", light: isLightBg()} : null,
		async (params) => params ? highlightCode(params.content.trim(), params.lang, params.light) : ""
	)

	return (
		<div class="chat-rich-block" classList={{open: open()}}>
			<button
				class="chat-rich-block-header"
				on:click={() => setOpen(!open())}
			>
				<svg class="chat-rich-block-chevron" viewBox="0 0 10 10" width="10" height="10">
					<path d="M3 2L7 5L3 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
				</svg>
				<span class="chat-rich-block-label">{label()}</span>
			</button>
			<Show when={open()}>
				<div class="chat-rich-block-body">
					<Show
						when={highlighted()}
						fallback={<pre class="chat-rich-block-code"><code>{props.block.content.trim()}</code></pre>}
					>
						<div class="chat-rich-block-code" innerHTML={highlighted()} />
					</Show>
					<Show when={props.block.result}>
						<div class="chat-rich-block-result-label">Result</div>
						<Show
							when={resultHighlighted()}
							fallback={<pre class="chat-rich-block-code"><code>{props.block.result}</code></pre>}
						>
							<div class="chat-rich-block-code" innerHTML={resultHighlighted()} />
						</Show>
					</Show>
				</div>
			</Show>
		</div>
	)
}
