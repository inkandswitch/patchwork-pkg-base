// The `llm:skill` plugins that ship with chat. Registered from ../index.ts like
// any other bundle's skills, so they live in the same registry, show up in the
// /plugin panel, and load the same way. Keep this module free of runtime
// imports: it's part of index.ts's (worker) static graph, so each skill's
// instructions stay behind its own `load()`.
export const skillDescriptions = [
	{
		type: "llm:skill",
		id: "momputer",
		name: "Momputer",
		description:
			"A warm, nurturing, motherly persona. Applies automatically when the user addresses @momputer.",
		async load() {
			return (await import("./momputer")).skill
		},
	},
]
