// Agent drafts — the Agent context-tool's "LLM edits land on a draft" flow,
// built on the drafts plugin's document model. The drafts package can't be
// imported (every tool in this repo is standalone), so the doc shapes and the
// fork/merge/unlink recipes are restated here against the same conventions
// (see drafts/src/draft-types.ts): a host doc points at its main DraftDoc via
// `@patchwork.mainDraftUrl`, top-level drafts hang off `mainDraft.drafts`, and
// each draft's `clones` maps original doc urls to per-draft clones (written
// lazily by the overlay as docs get resolved beneath it while the draft is
// checked out).
//
// Everything here goes through the RAW `window.repo`, never a pane's
// OverlayRepo: the overlay forks every non-skipped doc resolved beneath it, so
// touching a clone (or the ephemeral checkout doc) through it while a draft is
// checked out would fork the draft machinery itself into the draft.
import {
	encodeHeads,
	isValidAutomergeUrl,
	parseAutomergeUrl,
	stringifyAutomergeUrl,
} from "@automerge/automerge-repo/slim"
import type {
	Repo,
	DocHandle,
	AutomergeUrl,
	UrlHeads,
} from "@automerge/automerge-repo/slim"
import {createSignal, createEffect, onCleanup, type Accessor} from "solid-js"
import {subscribe} from "./selected-doc"

/** `@patchwork.type` of agent chat docs AND their message docs. On the drafts
 * skip-list, so the conversation never forks into a draft (a rejected draft
 * must not take the chat history — including the accept/reject exchange —
 * with it). */
export const AGENT_CHAT_TYPE = "agent-chat"

/** `@patchwork.type` of the per-document index doc holding the agent tool's
 * chat-tab list. Also skipped, so the tab list is identical on every branch:
 * chats don't appear/disappear as you switch drafts. */
export const AGENT_CHATS_INDEX_TYPE = "agent-chats"

// ── Drafts document model (mirrors drafts/src/draft-types.ts) ───────────────

export type CloneEntry = {
	cloneUrl: AutomergeUrl
	clonedAt: UrlHeads
	mergedAt?: UrlHeads
	/** The clone's heads at merge time — with `clonedAt`, brackets the head
	 * range the drafts timeline attributes to this draft after it merges. */
	mergedFrom?: UrlHeads
}

export type DraftDoc = {
	"@patchwork": {type: "draft"}
	isMain?: boolean
	name?: string
	parent: AutomergeUrl
	drafts: AutomergeUrl[]
	clones: Record<AutomergeUrl, CloneEntry>
	mergedAt?: number
	/** The draft the merge landed in, so its timeline can attribute this
	 * draft's changes to a dedicated "Merged …" group. */
	mergedInto?: AutomergeUrl
	draftCounter?: number
}

/** The ephemeral, per-client selection doc owned by the draft-state provider:
 * which draft is checked out (`null` = main) and the optional checkpoint. */
export type CheckedOutDraft = {
	checkedOut: AutomergeUrl | null
	at?: unknown | null
}

type HasDrafts = {
	"@patchwork"?: {type?: string; mainDraftUrl?: AutomergeUrl}
}

/** The Agent tool's per-document chat list. Lives in its own doc (pointed at
 * by `focusedDoc['@patchwork'].agentChats`) rather than on the focused doc,
 * because the focused doc forks per draft — an on-doc list would make chats
 * appear and disappear as branches are switched. */
export type AgentChatsIndexDoc = {
	"@patchwork": {type: string}
	chats: AutomergeUrl[]
}

/** The raw realm repo — bypasses any draft overlay between the tool and the
 * documents, so reads and writes always hit the real docs. */
export function rawRepo(): Repo {
	const repo = (window as {repo?: Repo}).repo
	if (!repo) throw new Error("[agent] window.repo is not set")
	return repo
}

/** Resolve the focused doc's agent-chats index, creating it (and migrating a
 * legacy on-doc `lmchats` array) on first use. `repo` must be the raw repo and
 * `targetUrl` the original (main) doc url: the pointer is branch-independent
 * metadata, so it is read from and written to the real doc even while a draft
 * is checked out — written through the overlay it would land on the clone and
 * be lost on reject. */
export async function resolveAgentChatsIndex(
	repo: Repo,
	targetUrl: AutomergeUrl
): Promise<DocHandle<AgentChatsIndexDoc>> {
	const target = await repo.find<HasDrafts & Record<string, unknown>>(
		targetUrl
	)
	const meta = target.doc()?.["@patchwork"] as
		| {agentChats?: AutomergeUrl; lmchats?: AutomergeUrl[]}
		| undefined
	const existing = meta?.agentChats
	if (existing && isValidAutomergeUrl(existing)) {
		return repo.find<AgentChatsIndexDoc>(existing)
	}
	const legacy = meta?.lmchats
	const index = await repo.create2<AgentChatsIndexDoc>({
		"@patchwork": {type: AGENT_CHATS_INDEX_TYPE},
		chats: Array.isArray(legacy) ? [...legacy] : [],
	})
	target.change((d) => {
		const anyDoc = d as {
			"@patchwork"?: {agentChats?: AutomergeUrl; lmchats?: unknown}
		}
		if (!anyDoc["@patchwork"]) anyDoc["@patchwork"] = {}
		if (!anyDoc["@patchwork"].agentChats)
			anyDoc["@patchwork"].agentChats = index.url
		if (Array.isArray(anyDoc["@patchwork"].lmchats))
			delete anyDoc["@patchwork"].lmchats
	})
	// Re-read: a concurrent creator may have won the pointer.
	const settled = (
		target.doc()?.["@patchwork"] as {agentChats?: AutomergeUrl} | undefined
	)?.agentChats
	return settled && settled !== index.url
		? repo.find<AgentChatsIndexDoc>(settled)
		: index
}

/** Fork a new draft off the target doc's live main and return its url. Forking
 * main live needs no eager clones — the overlay's lazy resolveClone forks each
 * doc at its current heads the first time it's resolved beneath the draft. */
export async function createAgentDraft(
	repo: Repo,
	targetUrl: AutomergeUrl,
	name: string
): Promise<AutomergeUrl> {
	const target = await repo.find<HasDrafts>(targetUrl)
	const mainDraft = await ensureMainDraft(repo, target)
	const draft = await repo.create2<DraftDoc>({
		"@patchwork": {type: "draft"},
		name,
		parent: mainDraft.url,
		drafts: [],
		clones: {},
	})
	mainDraft.change((d) => {
		d.drafts.push(draft.url)
	})
	return draft.url
}

/** Resolve the host doc's main draft, creating it and stamping
 * `@patchwork.mainDraftUrl` the first time (the draft-state provider creates
 * it eagerly for selected docs, so this is normally just a lookup). */
async function ensureMainDraft(
	repo: Repo,
	target: DocHandle<HasDrafts>
): Promise<DocHandle<DraftDoc>> {
	const existing = target.doc()?.["@patchwork"]?.mainDraftUrl
	if (existing && isValidAutomergeUrl(existing)) {
		return repo.find<DraftDoc>(existing)
	}
	const mainDraft = await repo.create2<DraftDoc>({
		"@patchwork": {type: "draft"},
		isMain: true,
		parent: target.url,
		drafts: [],
		clones: {},
	})
	target.change((d) => {
		// Mutate `@patchwork` in place — reassigning a spread would carry
		// references to existing Automerge objects into a new object.
		if (!d["@patchwork"]) d["@patchwork"] = {}
		if (!d["@patchwork"]!.mainDraftUrl)
			d["@patchwork"]!.mainDraftUrl = mainDraft.url
	})
	// Re-read: a concurrent creator may have won the pointer.
	const settled = target.doc()?.["@patchwork"]?.mainDraftUrl
	return settled && settled !== mainDraft.url
		? repo.find<DraftDoc>(settled)
		: mainDraft
}

/** Accept: merge every cloned doc back into the parent draft's copy of it —
 * the parent's clone when it has one, adopting the clone into the parent's
 * map when it doesn't (a member the parent never forked must stay scoped to
 * the parent, not leak into the original) — then mark the draft merged
 * (which hides it from the drafts sidebar). Records `mergedFrom` per member
 * and `mergedInto` on the draft, the provenance the drafts timeline reads to
 * attribute the merged changes to a dedicated "Merged …" group. Children
 * (unlikely on agent drafts) are handed up to the merge target so they never
 * dangle under a hidden draft. Mirrors the sidebar's mergeDraft. */
export async function mergeAgentDraft(
	repo: Repo,
	draftUrl: AutomergeUrl
): Promise<void> {
	const draftHandle = await repo.find<DraftDoc>(draftUrl)
	const doc = draftHandle.doc()
	const parentHandle = await findMergeTarget(repo, doc?.parent)
	const parentIsMain = parentHandle?.doc()?.isMain === true
	const entries = Object.entries(doc?.clones ?? {}) as [
		AutomergeUrl,
		CloneEntry,
	][]
	for (const [originalUrl, entry] of entries) {
		// A member the target never forked: a real draft adopts the clone (no
		// data moves); main gets the identity entry its clone sync would
		// eventually add, so its timeline is guaranteed to include the member.
		if (parentHandle && !parentHandle.doc()?.clones[originalUrl]) {
			// Copy the heads array: it was read out of the draft's doc, and a
			// live Automerge object must not be assigned into another document.
			const adopted: CloneEntry = parentIsMain
				? {cloneUrl: originalUrl, clonedAt: encodeHeads([])}
				: {
						cloneUrl: entry.cloneUrl,
						clonedAt: [...entry.clonedAt] as UrlHeads,
					}
			parentHandle.change((d) => {
				if (!d.clones[originalUrl]) d.clones[originalUrl] = adopted
			})
		}
		// Re-read the target's clones: the adoption above (or a concurrent
		// creator winning its guard) may have just changed the mapping.
		const parentClones = parentHandle?.doc()?.clones ?? {}
		const targetUrl = parentClones[originalUrl]?.cloneUrl ?? originalUrl
		const clone = await repo.find<unknown>(entry.cloneUrl)
		const mergedFrom = clone.heads()
		if (entry.cloneUrl === targetUrl) {
			// The clone IS the target's copy (adopted above, or an identity
			// entry); nothing to merge — just record the join point.
			draftHandle.change((d) => {
				const e = d.clones[originalUrl]
				if (e && mergedFrom) {
					e.mergedAt = mergedFrom
					e.mergedFrom = mergedFrom
				}
			})
			continue
		}
		const target = await repo.find<unknown>(targetUrl)
		target.merge(clone)
		const mergedAt = target.heads()
		draftHandle.change((d) => {
			const e = d.clones[originalUrl]
			if (e && mergedAt && mergedFrom) {
				e.mergedAt = mergedAt
				e.mergedFrom = mergedFrom
			}
		})
	}
	draftHandle.change((d) => {
		d.mergedAt = Date.now()
		if (parentHandle) d.mergedInto = parentHandle.url
	})

	if (parentHandle) {
		const children = (draftHandle.doc()?.drafts ?? []).filter(
			isValidAutomergeUrl
		)
		for (const childUrl of children) {
			try {
				const child = await repo.find<DraftDoc>(childUrl)
				child.change((d) => {
					d.parent = parentHandle.url
				})
				parentHandle.change((d) => {
					if (!d.drafts.includes(childUrl)) d.drafts.push(childUrl)
				})
				draftHandle.change((d) => {
					const i = d.drafts.indexOf(childUrl)
					if (i >= 0) d.drafts.splice(i, 1)
				})
			} catch (err) {
				console.warn("[agent] failed to re-parent child draft:", childUrl, err)
			}
		}
	}
}

/** The draft the merge should land in: the nearest non-merged ancestor (a
 * merged-away parent hands its role up the chain, ending at the main draft,
 * which is never merged). Null when the chain can't be resolved — the caller
 * then falls back to merging into the originals. */
async function findMergeTarget(
	repo: Repo,
	parentUrl: AutomergeUrl | undefined
): Promise<DocHandle<DraftDoc> | null> {
	const seen = new Set<AutomergeUrl>()
	let cursor = parentUrl
	while (cursor && isValidAutomergeUrl(cursor) && !seen.has(cursor)) {
		seen.add(cursor)
		try {
			const candidate = await repo.find<DraftDoc>(cursor)
			if (candidate.doc()?.mergedAt === undefined) return candidate
			cursor = candidate.doc()?.parent
		} catch (err) {
			console.warn("[agent] failed to load ancestor draft for merge:", err)
			return null
		}
	}
	return null
}

/** Reject: unlink the draft from its parent's `drafts` list, which drops it
 * from every peer's tree walk. Nothing is merged; the clones are left in
 * place, just unreachable. Mirrors the sidebar's delete. */
export async function rejectAgentDraft(
	repo: Repo,
	draftUrl: AutomergeUrl
): Promise<void> {
	const draftHandle = await repo.find<DraftDoc>(draftUrl)
	const parentUrl = draftHandle.doc()?.parent
	if (!parentUrl || !isValidAutomergeUrl(parentUrl)) return
	const parent = await repo.find<DraftDoc>(parentUrl)
	parent.change((d) => {
		const i = d.drafts.indexOf(draftUrl)
		if (i >= 0) d.drafts.splice(i, 1)
	})
}

/** Solid accessor for the ephemeral CheckedOutDraft handle, resolved from the
 * ancestor draft-state provider's `draft:checked-out` selector — writing
 * `checkedOut` on it is how a branch gets checked out. Resolved via the raw
 * repo (the checkout doc carries no `@patchwork.type`, so an overlay find
 * would fork it into the current draft). Null while unresolved, or when no
 * draft-state provider answers (drafts plugin absent). */
export function checkedOutDraftHandle(
	element: HTMLElement
): Accessor<DocHandle<CheckedOutDraft> | null> {
	const url = subscribe<AutomergeUrl | undefined>(
		element,
		{type: "draft:checked-out"},
		undefined
	)
	const [handle, setHandle] = createSignal<DocHandle<CheckedOutDraft> | null>(
		null
	)
	createEffect(() => {
		const u = url()
		if (!u || !isValidAutomergeUrl(u)) return
		let stale = false
		rawRepo()
			.find<CheckedOutDraft>(u)
			.then((h) => {
				if (!stale) setHandle(h)
			})
			.catch((e) => console.warn("[agent] checked-out doc:", e))
		onCleanup(() => {
			stale = true
		})
	})
	return handle
}

/** Check out a draft (`null` = main), returning to the live latest heads —
 * same move as the sidebar's selectDraft. No-op when already there (so a
 * user-scrubbed checkpoint on the same branch isn't clobbered). */
export function checkoutDraft(
	handle: DocHandle<CheckedOutDraft>,
	url: AutomergeUrl | null
): void {
	if ((handle.doc()?.checkedOut ?? null) === url) return
	handle.change((d) => {
		d.checkedOut = url
		d.at = null
	})
}

/** Check out an agent draft WITH diff baselines: every member diffs against
 * its fork point (the sidebar's eye-open view), so the document view
 * highlights exactly what the agent has changed. Re-running on an
 * already-checked-out draft refreshes the baselines — docs forked since the
 * last checkout (the overlay adds clones lazily) get theirs added. */
export async function checkoutAgentDraft(
	repo: Repo,
	handle: DocHandle<CheckedOutDraft>,
	draftUrl: AutomergeUrl
): Promise<void> {
	const baselines: Record<AutomergeUrl, {from: UrlHeads}> = {}
	try {
		const draft = await repo.find<DraftDoc>(draftUrl)
		const clones = draft.doc()?.clones ?? {}
		for (const [original, entry] of Object.entries(clones)) {
			if (entry.clonedAt)
				baselines[original as AutomergeUrl] = {from: entry.clonedAt}
		}
	} catch (e) {
		console.warn("[agent] draft baselines:", e)
	}
	handle.change((d) => {
		d.checkedOut = draftUrl
		d.at = Object.keys(baselines).length > 0 ? baselines : null
	})
}

// Datatypes the draft machinery never forks — mirrors
// drafts/src/clone-policy.ts (this package can't import the drafts package at
// build time; keep the two lists in step).
const SKIPPED_DATATYPES = new Set([
	"account",
	"contact",
	"draft",
	"change-group",
	"change-group-cache",
	AGENT_CHAT_TYPE,
	AGENT_CHATS_INDEX_TYPE,
])

/** Reduce a url to its bare document identity (strip heads/path suffixes) so
 * urls from different traversals dedupe to the same clones key. Mirrors the
 * overlay's canonicalUrl. */
function canonicalUrl(url: AutomergeUrl): AutomergeUrl {
	return stringifyAutomergeUrl({documentId: parseAutomergeUrl(url).documentId})
}

/** Resolve a document AGAINST A SPECIFIC DRAFT, independent of the global
 * checkout: return the draft's clone of the doc, forking the original at its
 * current heads (and recording the fork point in `DraftDoc.clones`) on first
 * touch — the same move as the overlay's resolveClone, but aimed by the
 * caller instead of by the checked-out selection. Skipped datatypes pass
 * through to the real doc, exactly like the overlay.
 *
 * This is what lets every chat tab's agent write to ITS OWN draft while the
 * user switches tabs or browses other branches: run-time reads/writes go
 * through here, and the checkout stays a purely visual concern.
 *
 * ⚠ Callers must keep the returned handle's url to themselves: a clone url fed
 * back in as `url` is not recognised as a clone (`clones` is keyed by the
 * ORIGINALS), so it gets cloned in turn. Report the original url instead — see
 * resolveRunDoc in components/ChatRoot.tsx. */
export async function resolveInDraft(
	repo: Repo,
	draftUrl: AutomergeUrl,
	url: AutomergeUrl
): Promise<DocHandle<any>> {
	const original = canonicalUrl(url)
	const draft = await repo.find<DraftDoc>(draftUrl)
	const existing = draft.doc()?.clones?.[original]
	if (existing) return repo.find(canonicalUrl(existing.cloneUrl))

	const originalHandle = await repo.find<Record<string, unknown>>(original)
	const type = (originalHandle.doc() as any)?.["@patchwork"]?.type
	if (typeof type === "string" && SKIPPED_DATATYPES.has(type)) {
		return originalHandle
	}
	// Re-check after the async find: a concurrent resolution (another run, or
	// the overlay itself while this draft is checked out) may have recorded a
	// clone meanwhile.
	const raced = draft.doc()?.clones?.[original]
	if (raced) return repo.find(canonicalUrl(raced.cloneUrl))

	const clonedAt = originalHandle.heads()
	const clone = repo.clone(originalHandle)
	const cloneUrl = canonicalUrl(clone.url)
	draft.change((d) => {
		if (!d.clones[original]) d.clones[original] = {cloneUrl, clonedAt}
	})
	// Honor whichever record won (ours, or a racing writer's).
	const settled = draft.doc()?.clones?.[original]
	return settled && settled.cloneUrl !== cloneUrl
		? repo.find(canonicalUrl(settled.cloneUrl))
		: clone
}

/** Extra fields for a message doc created inside `chatDoc`: agent chats stamp
 * their message docs with the skipped datatype so the overlay never forks
 * them (messages are created empty and streamed into — a forked message would
 * lose its text when the draft is rejected). Empty for ordinary chats. */
export function agentMessageMetadata(
	chatDoc: unknown
): Record<string, unknown> {
	const type = (chatDoc as {"@patchwork"?: {type?: string}} | undefined)?.[
		"@patchwork"
	]?.type
	return type === AGENT_CHAT_TYPE
		? {"@patchwork": {type: AGENT_CHAT_TYPE}}
		: {}
}
