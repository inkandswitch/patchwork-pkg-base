// Where a canvas is being looked at, as its view state (view-state.ts):
// `{tldraw: {page, bounds: {x, y, w, h}}}`, the page, and the part of it
// that's showing, so someone following sees the same part whatever shape
// their window is (as tldraw's own following does). Theirs heard, it goes
// there; it's this one's own moving about that's written back.
//
// The same file is in tldraw4 and tldraw5.
import type {Editor, TLPageId} from "@tldraw/tldraw"
import {viewStateOf, type ViewState} from "./view-state"

type FindingRepo = Parameters<typeof viewStateOf>[1]
type Bounds = {x: number; y: number; w: number; h: number}
type Camera = {page: string; bounds: Bounds}

// moving this long after one of theirs is taken as the canvas catching up
const SETTLING = 150

const round = (n: number) => Math.round(n * 100) / 100
const isNumber = (n: unknown): n is number =>
	typeof n === "number" && Number.isFinite(n)
const isBounds = (b: unknown): b is Bounds => {
	const box = b as Partial<Bounds> | null
	return (
		!!box &&
		isNumber(box.x) &&
		isNumber(box.y) &&
		isNumber(box.w) &&
		isNumber(box.h) &&
		box.w > 0 &&
		box.h > 0
	)
}

function cameraOf(editor: Editor): Camera {
	const {x, y, w, h} = editor.getViewportPageBounds()
	return {
		page: editor.getCurrentPageId(),
		bounds: {x: round(x), y: round(y), w: round(w), h: round(h)},
	}
}

/** keep `editor`'s camera and page as the view state of `element`'s view. returns a stop */
export function shareCamera(
	element: HTMLElement,
	repo: FindingRepo | undefined,
	editor: Editor,
): () => void {
	let theirsUntil = 0
	// what it was last said to be, by this or by theirs
	let said = ""

	const link = viewStateOf(element, repo, (state: ViewState) => {
		const theirs = state.tldraw as {page?: unknown; bounds?: unknown} | undefined
		if (!theirs || !isBounds(theirs.bounds)) return
		said = JSON.stringify({page: theirs.page, bounds: theirs.bounds})
		theirsUntil = performance.now() + SETTLING
		const page = typeof theirs.page === "string" ? (theirs.page as TLPageId) : null
		if (page && page !== editor.getCurrentPageId() && editor.getPage(page)) {
			editor.setCurrentPage(page)
		}
		editor.zoomToBounds(theirs.bounds, {inset: 0, immediate: true, force: true})
	})

	let frame = 0
	function onChange() {
		frame ||= requestAnimationFrame(() => {
			frame = 0
			if (performance.now() < theirsUntil) return
			const now = cameraOf(editor)
			const json = JSON.stringify(now)
			if (json === said) return
			said = json
			link.set({tldraw: now})
		})
	}
	// the camera, and which page: session records
	const off = editor.store.listen(onChange, {scope: "session"})
	// where it starts
	const start = cameraOf(editor)
	said = JSON.stringify(start)
	link.set({tldraw: start})

	return () => {
		cancelAnimationFrame(frame)
		off()
		link.stop()
	}
}
