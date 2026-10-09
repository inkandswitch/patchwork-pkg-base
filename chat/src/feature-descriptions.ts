import type {FeaturePlugin} from "./features"

// The built-in feature declarations, as metadata only. This module is part of
// index.ts's (worker) static graph, so keep it free of runtime imports: the host
// reads `plugins` in a module worker, which has no importmap, so a static path to
// `solid-js` there fails the whole package. Slots stay behind `load()`.
export const featureMetadata: Omit<FeaturePlugin, "slots">[] = [
	{type: "chat:feature", id: "presence", name: "Presence", tier: "core"},
	{type: "chat:feature", id: "typing", name: "Typing indicator", tier: "core"},
	{type: "chat:feature", id: "computer", name: "Computer (AI)", tier: "full"},
	{type: "chat:feature", id: "selection-mention", name: "Selection mention", tier: "core"},
]

// Serializable registry descriptions (the same pattern as slash/messageaction/
// emojipack descriptions): function-valued `slots` can't be DataClone'd raw.
export const featureDescriptions = featureMetadata.map((meta) => ({
	...meta,
	async load() {
		const {featurePlugins} = await import("./features")
		return {slots: featurePlugins.find((p) => p.id === meta.id)?.slots}
	},
}))
