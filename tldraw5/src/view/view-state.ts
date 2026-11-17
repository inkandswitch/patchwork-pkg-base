// How this view is being looked at, past the doc it shows: where it's
// scrolled to, a camera. Whatever it's in can keep that for it, by answering
// `patchwork:view-state` (the call does, in a place a frame lets be
// followed; lattice does, in its panes). The answer is a doc's url, found
// with the repo this view was given and written as things change. While
// someone's being followed, that doc is a copy of theirs, so a change comes
// that this didn't make, and the view goes where they are. With nothing
// answering, it's nothing.
//
// The same file is in each tool that keeps a view state (file,
// codemirror-base, tldraw4, tldraw5): tools don't share code at build time.
import {subscribe} from "@inkandswitch/patchwork-providers"

export type ViewState = Record<string, unknown>

type Handle = {
	doc(): unknown
	change(fn: (doc: Record<string, unknown>) => void): void
	on(event: "change", fn: () => void): void
	off(event: "change", fn: () => void): void
}
type FindingRepo = {find(url: never): Promise<unknown>}

export interface ViewStateLink {
	/** write these fields (undefined ones go) */
	set(fields: ViewState): void
	stop(): void
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const plain = (doc: unknown): ViewState =>
	JSON.parse(JSON.stringify(doc ?? {})) as ViewState

/**
 * The view state of the view at `element`, found with `repo` (the one it
 * was given). `onState` hears it, plain, whenever it changes to other than
 * what was last set here: someone you follow's, say. What's set before it's
 * found is written once it is, unless there's something there already.
 */
export function viewStateOf(
	element: HTMLElement,
	repo: FindingRepo | undefined,
	onState: (state: ViewState) => void,
): ViewStateLink {
	let handle: Handle | null = null
	let last = ""
	let stopped = false
	let pending: ViewState | null = null
	// (a handle says it's changed while it's being changed)
	let writing = false

	function read() {
		if (!handle || stopped || writing) return
		const state = plain(handle.doc())
		const json = JSON.stringify(state)
		if (json === last) return
		last = json
		onState(state)
	}

	function write(fields: ViewState) {
		if (!handle) return
		writing = true
		try {
			handle.change(doc => {
				for (const [key, value] of Object.entries(fields)) {
					if (value === undefined) delete doc[key]
					else if (!same(doc[key], value)) doc[key] = value
				}
			})
		} finally {
			writing = false
		}
		last = JSON.stringify(plain(handle.doc()))
	}

	const off = repo
		? subscribe<string>(element, {type: "patchwork:view-state"}, async url => {
				if (stopped || typeof url !== "string") return
				let found: Handle
				try {
					found = (await repo.find(url as never)) as Handle
				} catch {
					return
				}
				if (stopped) return
				handle?.off("change", read)
				handle = found
				handle.on("change", read)
				const had = Object.keys(plain(handle.doc())).length > 0
				read()
				if (pending && !had) write(pending)
				pending = null
			})
		: () => {}

	return {
		set(fields) {
			if (stopped) return
			if (!handle) {
				pending = {...pending, ...fields}
				return
			}
			write(fields)
		},
		stop() {
			stopped = true
			off()
			handle?.off("change", read)
		},
	}
}
