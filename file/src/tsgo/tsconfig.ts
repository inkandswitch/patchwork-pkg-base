// the one tsconfig for every file tsgo has, at / (tsgo-worker.ts)
export const TSCONFIG = JSON.stringify({
	compilerOptions: {
		target: "esnext",
		module: "esnext",
		moduleResolution: "bundler",
		allowJs: true,
		checkJs: false,
		noEmit: true,
		strict: true,
		skipLibCheck: true,
		lib: ["esnext", "dom"],
		jsx: "preserve",
		// each document is a folder, so an import of one (with or without a
		// leading slash) is its index.js. they're relative to this file, at /:
		// no baseUrl needed (typescript 7 drops it). tsgo.test.ts checks
		// they resolve
		paths: {
			"automerge:*": ["./*/index.js"],
			"/automerge:*": ["./*/index.js"],
		},
	},
	include: ["**/*"],
})
