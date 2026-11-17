// Where an editor's scrolled to, as its view state (view-state.ts):
// `{text: {top}}`, the position in the doc at the top of what's showing, so
// someone following goes to the same place however tall their window is.
// Their scroll heard, it's scrolled to; it's this one's own scrolling that's
// written back.
//
// The same file is in file and codemirror-base.
import {EditorView} from "@codemirror/view"
import {viewStateOf, type ViewState} from "./view-state"

type FindingRepo = Parameters<typeof viewStateOf>[1]

// a scroll this long after one of theirs is taken as the editor catching up
const SETTLING = 150

/** the position at the top of what `view` shows */
function topOf(view: EditorView) {
	const scroller = view.scrollDOM.getBoundingClientRect()
	// (if something round it does the scrolling, it's the window's top)
	const top = Math.max(scroller.top, 0)
	return view.lineBlockAtHeight(top - view.documentTop).from
}

/** keep `view`'s scroll as the view state of `element`'s view. returns a stop */
export function shareScroll(
	element: HTMLElement,
	repo: FindingRepo | undefined,
	view: EditorView,
): () => void {
	let theirsUntil = 0
	// where it was last said to be, by this or by theirs
	let top = 0

	const link = viewStateOf(element, repo, (state: ViewState) => {
		const text = state.text as {top?: unknown} | undefined
		if (typeof text?.top !== "number") return
		const pos = Math.max(0, Math.min(Math.round(text.top), view.state.doc.length))
		top = pos
		if (pos === topOf(view)) return
		theirsUntil = performance.now() + SETTLING
		view.dispatch({effects: EditorView.scrollIntoView(pos, {y: "start"})})
	})

	let frame = 0
	function onScroll() {
		frame ||= requestAnimationFrame(() => {
			frame = 0
			if (performance.now() < theirsUntil) return
			const now = topOf(view)
			if (now === top) return
			top = now
			link.set({text: {top}})
		})
	}
	view.scrollDOM.addEventListener("scroll", onScroll, {passive: true})
	// something round it scrolling it
	addEventListener("scroll", onScroll, {capture: true, passive: true})
	// where it starts
	link.set({text: {top: 0}})

	return () => {
		cancelAnimationFrame(frame)
		view.scrollDOM.removeEventListener("scroll", onScroll)
		removeEventListener("scroll", onScroll, {capture: true})
		link.stop()
	}
}
