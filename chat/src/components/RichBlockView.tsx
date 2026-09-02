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
	checkoutAgentDraft,
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
						fallback={
							<Show
								when={block.type === "scenario-review"}
								fallback={<RichBlockView block={block} />}>
								<ScenarioReviewBlock
									block={block}
									messageUrl={props.messageUrl}
								/>
							</Show>
						}>
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

/** The multi-scenario picker: one chip per scenario branch a run produced.
 * Clicking a chip checks that branch out (with diff baselines) and makes it
 * the chat's open draft, so the user can flip back and forth through the
 * alternatives in the document view. Accept merges the SELECTED scenario and
 * unlinks the rest; Reject all unlinks everything. The outcome is stamped on
 * the block's `result` (\`accepted:<url>\` / "rejected") so the embed freezes
 * for every peer, mirroring DraftReviewBlock. */
function ScenarioReviewBlock(props: {
	block: RichBlock
	messageUrl?: AutomergeUrl
}) {
	const {handle, doc, element} = useChat()
	const checkedOut = checkedOutDraftHandle(element)
	const [busy, setBusy] = createSignal(false)

	const scenarios = (): {url: AutomergeUrl; name: string}[] => {
		try {
			const parsed = JSON.parse(props.block.content)
			if (!Array.isArray(parsed)) return []
			return parsed.filter(
				(s: any) =>
					s &&
					typeof s.name === "string" &&
					isValidAutomergeUrl(s.url)
			)
		} catch {
			return []
		}
	}
	const decided = () => props.block.result
	// Actionable while the chat's open draft is still one of these scenarios
	// (a later run replaces the open draft, which closes this picker).
	const open = () =>
		!decided() &&
		scenarios().some((s) => (doc() as any)?.agentDraftUrl === s.url)
	const selected = (): AutomergeUrl | null => {
		const current = (doc() as any)?.agentDraftUrl
		return scenarios().some((s) => s.url === current) ? current : null
	}
	const acceptedUrl = () => {
		const r = decided()
		return r?.startsWith("accepted:") ? r.slice("accepted:".length) : null
	}

	/** Chip click: browse this scenario — check its branch out and make it
	 * the chat's open draft (so follow-up messages continue on it). */
	async function view(url: AutomergeUrl) {
		if (!open() || busy()) return
		handle.change((d: any) => {
			d.agentDraftUrl = url
		})
		const co = checkedOut()
		if (co) {
			try {
				await checkoutAgentDraft(rawRepo(), co, url)
			} catch (e) {
				console.warn("[agent] scenario checkout:", e)
			}
		}
	}

	async function accept() {
		const chosen = selected()
		if (!chosen || busy() || !open()) return
		setBusy(true)
		try {
			const repo = rawRepo()
			await mergeAgentDraft(repo, chosen)
			for (const s of scenarios()) {
				if (s.url !== chosen) await rejectAgentDraft(repo, s.url)
			}
			await settle("accepted:" + chosen)
		} catch (e) {
			console.warn("[agent] scenario accept failed:", e)
		} finally {
			setBusy(false)
		}
	}

	async function rejectAll() {
		if (busy() || !open()) return
		setBusy(true)
		try {
			const repo = rawRepo()
			for (const s of scenarios()) {
				await rejectAgentDraft(repo, s.url)
			}
			await settle("rejected")
		} catch (e) {
			console.warn("[agent] scenario reject failed:", e)
		} finally {
			setBusy(false)
		}
	}

	/** Either way the story ends on main: check it out, close the chat's
	 * open draft, and freeze this embed for every peer. */
	async function settle(result: string) {
		const co = checkedOut()
		if (co) checkoutDraft(co, null)
		const urls = new Set(scenarios().map((s) => s.url))
		handle.change((d: any) => {
			if (urls.has(d.agentDraftUrl)) delete d.agentDraftUrl
		})
		if (props.messageUrl) {
			const mh = await rawRepo().find<{richBlocks?: RichBlock[]}>(
				props.messageUrl
			)
			mh.change((d) => {
				const block = (d.richBlocks || []).find(
					(b) =>
						b.type === "scenario-review" &&
						b.content === props.block.content &&
						!b.result
				)
				if (block) block.result = result
			})
		}
	}

	const acceptedName = () =>
		scenarios().find((s) => s.url === acceptedUrl())?.name

	return (
		<div
			class="chat-scenario-review"
			data-state={
				decided()
					? decided() === "rejected"
						? "rejected"
						: "accepted"
					: open()
						? "open"
						: "closed"
			}>
			<div class="chat-scenario-review-header">
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
				<span class="chat-scenario-review-title">
					{scenarios().length}{" "}
					{scenarios().length === 1 ? "scenario" : "scenarios"}
				</span>
				<Show
					when={!decided() && open()}
					fallback={
						<span class="chat-draft-review-state">
							{acceptedUrl()
								? `Accepted “${acceptedName() || "scenario"}”`
								: decided() === "rejected"
									? "Rejected"
									: "Closed"}
						</span>
					}>
					<span class="chat-draft-review-actions">
						<button
							class="chat-draft-review-btn chat-draft-review-accept"
							disabled={busy() || !selected()}
							title="Merge the selected scenario; the others are discarded"
							on:click={accept}>
							Accept selected
						</button>
						<button
							class="chat-draft-review-btn chat-draft-review-reject"
							disabled={busy()}
							on:click={rejectAll}>
							Reject all
						</button>
					</span>
				</Show>
			</div>
			<div class="chat-scenario-review-chips" role="tablist">
				<For each={scenarios()}>
					{(s) => (
						<button
							class="chat-scenario-chip"
							role="tab"
							aria-selected={selected() === s.url}
							data-selected={
								(decided() ? acceptedUrl() === s.url : selected() === s.url)
									? ""
									: undefined
							}
							disabled={busy() || !open()}
							title={
								open()
									? "View this scenario in the document"
									: undefined
							}
							on:click={() => view(s.url)}>
							{s.name}
						</button>
					)}
				</For>
			</div>
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
