import {followCurrentTheme} from "@inkandswitch/patchwork-plugins"

export function ThemeTitlebarTool(_handle: any, element: HTMLElement) {
	// Isolated, so it can't see the host's <html>: put the host's theme on this
	// document's instead.
	const unsubscribe = followCurrentTheme(element)
	element.style.width = "0"
	element.style.height = "0"
	element.style.overflow = "hidden"
	element.style.flex = "0 0 0"
	element.style.pointerEvents = "none"

	return () => {
		unsubscribe()
	}
}
