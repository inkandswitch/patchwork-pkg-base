import type {EditorView} from "@codemirror/view"

export enum mod {
	shift = 1,
	control = 2,
	option = 3,
	command = 4,
}

export function modshift(event: {
	ctrlKey: boolean
	shiftKey: boolean
	altKey: boolean
	metaKey: boolean
}) {
	let bits = 0
	bits |= +event.shiftKey << mod.shift
	bits |= +event.ctrlKey << mod.control
	bits |= +event.altKey << mod.option
	bits |= +event.metaKey << mod.command
	return bits
}

const MIN_FONT_SIZE = 6

// cmd+= / cmd+- / cmd+0 (ctrl off a Mac) resize the editor's text instead
// of zooming the whole page. Put it on the element wrapping the view.
export function zoomKeydown(view: EditorView) {
	const apple = ["Mac", "iPhone", "iPad"].some((name) =>
		navigator.platform.includes(name),
	)
	const zoomMask = 1 << (apple ? mod.command : mod.control)
	return (event: KeyboardEvent) => {
		if ((modshift(event) & ~(1 << mod.shift)) != zoomMask) return
		let step
		if (event.key == "=" || event.key == "+") step = 1
		else if (event.key == "-" || event.key == "_") step = -1
		else if (event.key == "0") step = 0
		else return
		event.preventDefault()
		event.stopPropagation()
		if (step == 0) {
			view.dom.style.fontSize = ""
		} else {
			const size = parseFloat(getComputedStyle(view.dom).fontSize)
			view.dom.style.fontSize = `${Math.max(MIN_FONT_SIZE, size + step)}px`
		}
		view.requestMeasure()
	}
}
