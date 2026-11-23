import {subscribe} from "@inkandswitch/patchwork-providers"
import {
	THEME_PREFERENCES_TOOL_ID,
	type ThemeMode,
	type ThemePreferences,
} from "@inkandswitch/patchwork-plugins"

/**
 * The account's theme preferences doc: `light` and `dark`, the theme id
 * chosen for each mode. The host reads it and puts the theme on the page
 * (see `@inkandswitch/patchwork-plugins`' themes); these tools only write it.
 */
export type ThemePreferencesHandle = {
	url?: string
	doc(): (ThemePreferences & {"@patchwork"?: {type: string}}) | undefined
	change(fn: (doc: any) => void): void
	on?(event: "change", listener: () => void): void
	off?(event: "change", listener: () => void): void
}

/** Mark the doc as theme preferences, so it opens in the theme picker. */
function ensureShape(handle: ThemePreferencesHandle) {
	if (handle.doc()?.["@patchwork"]?.type === "theme-preferences") return
	handle.change((doc: any) => {
		doc["@patchwork"] = {type: "theme-preferences"}
	})
}

export function setThemeForMode(
	handle: ThemePreferencesHandle,
	mode: ThemeMode | "both",
	themeId: string
) {
	ensureShape(handle)
	handle.change((doc: any) => {
		if (mode !== "dark") doc.light = themeId
		if (mode !== "light") doc.dark = themeId
	})
}

/**
 * Get the account's theme preferences doc from the frame's
 * `patchwork:tool-storage` provider, which makes it on first use. Calls
 * `onHandle` once it's found. Returns a function that stops looking.
 */
export function connectThemePreferences(
	element: HTMLElement,
	onHandle: (handle: ThemePreferencesHandle) => void
): () => void {
	let stopped = false
	let lastUrl: string | undefined
	const stop = subscribe<string>(
		element,
		{type: "patchwork:tool-storage", toolId: THEME_PREFERENCES_TOOL_ID},
		(url) => {
			if (!url || url === lastUrl) return
			lastUrl = url
			const repo = (element as any).repo ?? (window as any).repo
			if (!repo) return
			repo.find(url).then(
				(handle: ThemePreferencesHandle) => {
					if (!stopped && url === lastUrl) onHandle(handle)
				},
				() => {
					// Best effort: without the doc, a choice just can't be saved.
				}
			)
		}
	)
	return () => {
		stopped = true
		stop()
	}
}
