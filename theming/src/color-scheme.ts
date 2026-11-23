/**
 * Best-effort color scheme for a theme, sniffed out of its stylesheet's
 * `color-scheme: light|dark`, so the stylesheet is the one place it's said.
 * Returns `undefined` when it doesn't say (treated as scheme-agnostic by
 * callers). Shared by the theme tray and the theme picker tool so they group
 * light/dark themes the same way.
 */
export async function detectColorScheme(theme: {
	style?: string
}): Promise<"light" | "dark" | undefined> {
	if (!theme.style) return undefined
	try {
		const res = await fetch(theme.style)
		const css = await res.text()
		const match = css.match(/color-scheme:\s*(light|dark)/)
		return (match?.[1] as "light" | "dark") ?? undefined
	} catch {
		return undefined
	}
}
