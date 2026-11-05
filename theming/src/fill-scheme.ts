/**
 * Guess light/dark from the theme's fill, for themes that never say which they
 * are. A theme that sets `color-scheme` (or `--studio-scheme`) itself always
 * wins over this: theme.css reads `--studio-scheme` in a lower cascade layer,
 * and this only flips that variable via `data-studio-scheme` on the root.
 *
 * Without it a dark theme that forgets `color-scheme: dark` gets light native
 * scrollbars and form controls on a dark page.
 */

/** WCAG relative luminance of an sRGB colour given as 0-255 channels. */
export function relativeLuminance(r: number, g: number, b: number): number {
	const lin = (c: number) => {
		const s = c / 255
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/**
 * Below this a fill reads as dark. 0.2 sits a little above mid-grey (0.18)
 * so dim-but-not-black fills still count as dark.
 */
export const DARK_LUMINANCE = 0.2

export function schemeForRgb(r: number, g: number, b: number): "light" | "dark" {
	return relativeLuminance(r, g, b) < DARK_LUMINANCE ? "dark" : "light"
}

let ctx: CanvasRenderingContext2D | null | undefined

/** Resolve any CSS colour string to 0-255 rgba by painting one pixel. */
function toRgba(color: string): [number, number, number, number] | undefined {
	if (ctx === undefined) {
		try {
			const canvas = document.createElement("canvas")
			canvas.width = canvas.height = 1
			ctx = canvas.getContext("2d", {willReadFrequently: true})
		} catch {
			ctx = null
		}
	}
	if (!ctx) return undefined
	try {
		ctx.clearRect(0, 0, 1, 1)
		ctx.fillStyle = "#0000"
		ctx.fillStyle = color
		ctx.fillRect(0, 0, 1, 1)
		const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
		return [r, g, b, a]
	} catch {
		return undefined
	}
}

/** Read the resolved --studio-fill off the root and mark data-studio-scheme. */
export function updateFillScheme(root: HTMLElement = document.documentElement) {
	const host = document.body ?? root
	const probe = document.createElement("span")
	probe.style.cssText =
		"position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;background-color:var(--studio-fill)"
	host.appendChild(probe)
	const color = getComputedStyle(probe).backgroundColor
	probe.remove()

	const rgba = color ? toRgba(color) : undefined
	// fully transparent (or unreadable) tells us nothing; leave the default.
	if (!rgba || rgba[3] === 0) {
		root.removeAttribute("data-studio-scheme")
		return
	}
	root.setAttribute("data-studio-scheme", schemeForRgb(rgba[0], rgba[1], rgba[2]))
}

let scheduled = false

/** Coalesce several triggers (theme change, stylesheet loads) into one read. */
export function scheduleFillScheme() {
	if (scheduled || typeof requestAnimationFrame === "undefined") return
	scheduled = true
	requestAnimationFrame(() => {
		scheduled = false
		updateFillScheme()
	})
}
