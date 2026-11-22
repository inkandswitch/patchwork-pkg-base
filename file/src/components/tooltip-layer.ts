import type {Extension} from "@codemirror/state"
import {EditorView, ViewPlugin, tooltips} from "@codemirror/view"

// The editor's tooltips (hovers, completions, problems, comments) in a layer
// of their own: a popover, so it's in the page's top layer, over the whole
// window. Without it a tooltip near the editor's edge is cut off by whatever
// the editor is in, and inside patchwork's contained views (which place
// fixed things from themselves) it lands somewhere else.
//
// The layer's corner is the window's, so a tooltip lands in the same place
// however CodeMirror places it: from the window, as it does fixed tooltips,
// or from their parent, which it switches to once it thinks something has
// moved them (in Safari, whenever one has been placed before).
//
// The layer is inside the editor's DOM, so the tooltips get its custom
// properties. It's invisible and lets the mouse through, but for the
// tooltips themselves.
//
// It makes one layer, so it's for one editor: call it for each.
export function tooltipLayer(): Extension {
	const layer = document.createElement("div")
	layer.className = "cm-tooltip-layer"
	layer.setAttribute("popover", "manual")

	// it can only be shown once it's in the page, and it's hidden again if
	// it's taken out, so it's shown whenever the editor updates and it isn't
	// (a tooltip only comes with an update)
	const lift = () => {
		if (!layer.isConnected || typeof layer.showPopover != "function") return
		try {
			if (!layer.matches(":popover-open")) layer.showPopover()
		} catch {
			// no popovers here: the tooltips are where the layer is
		}
	}

	return [
		tooltips({position: "fixed", parent: layer}),
		ViewPlugin.define((view) => {
			view.dom.appendChild(layer)
			lift()
			return {
				update: lift,
				destroy() {
					try {
						if (layer.matches(":popover-open")) layer.hidePopover()
					} catch {}
					layer.remove()
				},
			}
		}),
		layerTheme,
	]
}

const layerTheme = EditorView.baseTheme({
	".cm-tooltip-layer": {
		position: "fixed",
		inset: "0",
		width: "auto",
		height: "auto",
		margin: "0",
		padding: "0",
		border: "0",
		background: "none",
		color: "inherit",
		overflow: "visible",
		pointerEvents: "none",
	},
	// CodeMirror puts the tooltips in a wrapper with the editor's theme
	// classes, so it gets the editor's own rules too (its fill, and all its
	// height): it keeps the ink and font, for the tooltips, but no more
	".cm-tooltip-layer > &": {
		height: "0",
		background: "none",
		overflow: "visible",
		outline: "none",
	},
	".cm-tooltip-layer .cm-tooltip": {
		pointerEvents: "auto",
	},
})
