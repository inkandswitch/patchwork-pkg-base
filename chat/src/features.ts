import type {PluginSelector} from "./lib/registry"
import {selectionFeature} from "./features/selection-mention"
import {featureMetadata} from "./feature-descriptions"

// Features are NOT a hardcoded struct on the component. Each big feature is a
// `chat:feature` plugin declaration (host-registrable, like the other four types);
// a tool enables features by passing ONE selector that applies across every plugin
// type. The component gates its UI on `hasFeature(id)` — it never holds a fixed
// list of known features.
//
// A tool's selector is `"all" | "core" | string[]`:
//   "all"     → every plugin of every type (built-in + host-contributed)
//   "core"    → only tier:"core" plugins (the minimal `chat` tool)
//   string[]  → an explicit set of plugin ids, spanning feature/parser/slash/…
//               types (a plugin id is matched regardless of its type)
export type FeatureSelector = PluginSelector

export interface FeaturePlugin {
	type: "chat:feature"
	id: string
	name: string
	tier: "core" | "full"
	// Optional render-slot contributions: slotId → Solid component authored against
	// the explicit SlotContext (see context/SlotContext.tsx, lib/slots.ts). A feature
	// carrying `slots` must be registered as a DESCRIPTION with the function fields
	// behind `async load()` (function-valued fields can't be DataClone'd raw).
	slots?: Record<string, (ctx: any, extra?: any) => any>
}

// The built-in feature declarations with their slots (also the registry fallback).
// Message send, contact avatars + names, inline `code`/`*bold*`/`_italic_`/fences,
// image send and patchwork-tool embedding are ALWAYS on (not gated) — they're the
// chat itself. Replies ride the (core-tier) `reply` message-action, so no flag here.
// The base `chat` tool owns only the core features plus the computer. Everything
// else (reactions, sidebar, voice, gifSelfie, emoticons, call, notifications) is
// contributed by the `chitter` bundle via the registry. The metadata lives in
// feature-descriptions.ts, which index.ts registers.
const featureSlots: Record<string, FeaturePlugin["slots"]> = {
	[selectionFeature.id]: selectionFeature.slots,
}

export const featurePlugins: FeaturePlugin[] = featureMetadata.map((meta) => ({
	...meta,
	...(featureSlots[meta.id] && {slots: featureSlots[meta.id]}),
}))
