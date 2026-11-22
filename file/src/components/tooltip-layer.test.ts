import {afterEach, describe, expect, it} from "vitest"
import {EditorState, StateField} from "@codemirror/state"
import {EditorView, showTooltip, type Tooltip} from "@codemirror/view"
import {tooltipLayer} from "./tooltip-layer"

const always = StateField.define<Tooltip>({
	create: () => ({
		pos: 0,
		create: () => {
			const dom = document.createElement("div")
			dom.textContent = "hi"
			return {dom}
		},
	}),
	update: (value) => value,
	provide: (field) => showTooltip.from(field),
})

let view: EditorView | undefined
afterEach(() => {
	view?.destroy()
	view?.dom.remove()
	view = undefined
})

function editor() {
	view = new EditorView({
		state: EditorState.create({doc: "text", extensions: [tooltipLayer(), always]}),
	})
	document.body.append(view.dom)
	return view
}

describe("tooltipLayer", () => {
	it("puts a popover layer in the editor, and the tooltips in it", () => {
		const view = editor()
		const layer = [...view.dom.children].find((child) => child.matches(".cm-tooltip-layer"))
		expect(layer?.getAttribute("popover")).toBe("manual")
		expect(layer?.querySelector(".cm-tooltip")?.textContent).toBe("hi")
	})

	it("gives each editor its own", () => {
		const one = editor()
		const two = new EditorView({extensions: [tooltipLayer(), always]})
		document.body.append(two.dom)
		const layerOf = (v: EditorView) => v.dom.querySelector(".cm-tooltip-layer")
		expect(layerOf(one)).not.toBe(layerOf(two))
		two.destroy()
		two.dom.remove()
	})

	it("takes the layer out when the editor goes", () => {
		const view = editor()
		view.destroy()
		expect(view.dom.querySelector(".cm-tooltip-layer")).toBeNull()
	})
})
