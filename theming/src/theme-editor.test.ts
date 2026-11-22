import {describe, expect, it} from "vitest"
import {generateThemeCss} from "./theme-editor.tsx"

describe("generateThemeCss", () => {
	it("leaves blank variables unset so fallbacks still apply", () => {
		const out = generateThemeCss("t", "light", {
			"--studio-fill": "#fff",
			"--studio-focus-ring": "",
			"--studio-density": "   ",
		})
		expect(out).toContain("--studio-fill: #fff;")
		expect(out).not.toContain("--studio-focus-ring")
		expect(out).not.toContain("--studio-density")
	})
})
