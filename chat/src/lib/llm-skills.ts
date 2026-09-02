// `llm:skill` — a domain instruction pack for the computer, registrable by any
// bundle through the host plugin registry (late-bound: a chat without a skill
// installed simply doesn't list it). A skill contributes:
//   - instructions: markdown appended to the system prompt while ACTIVE
//   - tools/runTool: optional extra LLM tools the skill implements itself
//
// A skill is active for a run when:
//   - the focused document's `@patchwork.type` is in its `datatypes`, or
//   - its id is enabled for the chat (`doc.plugins`, via /plugin load <id>), or
//   - the run forces it (e.g. @momputer forces the momputer skill).
//
// Skills are deliberately NOT part of the tier system: the "all" selector never
// auto-enables them (a chitterchatter with selector "all" must not inhale every
// registered skill into its prompt). They appear in the /plugin panel through
// pluginCatalog(), which lists them separately from BUILTIN_PLUGIN_TYPES.
//
// Registration shape (per the registry rules, functions live behind load()):
//   { type: "llm:skill", id, name, description, datatypes?, async load() {
//       return { instructions, tools?, runTool? } } }

import {mergePlugins, loadPlugin} from "./registry"

export type LlmSkillTool = {
	name: string
	description: string
	parameters?: any
}

export type LlmSkillToolCtx = {
	repo: any
	handle: any
	element: HTMLElement
	focusedUrl: string | undefined
	applyAutomerge: (doc: any, path: any[], range: any, value: any) => void
}

export type LlmSkillModule = {
	/** Markdown appended to the system prompt while the skill is active. */
	instructions: string
	/** Optional extra tool schemas offered to the model while active. */
	tools?: LlmSkillTool[]
	/** Implementation for this skill's tools. */
	runTool?: (
		name: string,
		args: any,
		ctx: LlmSkillToolCtx
	) => unknown | Promise<unknown>
}

export type LlmSkillDescription = {
	type: "llm:skill"
	id: string
	name: string
	/** One-liner ALWAYS shown to the model (the index) — write it like a
	 * trigger condition ("applies when…"), not marketing copy. */
	description: string
	/** Auto-activate when the focused doc's `@patchwork.type` matches. */
	datatypes?: string[]
	/** Built-ins carry load() inline; registry entries load via reg.load(id). */
	load?: () => Promise<LlmSkillModule>
}

export type ActiveSkill = {
	id: string
	name: string
	description: string
	module: LlmSkillModule
}

/** Every known skill: built-ins merged with host-registered ones (built-ins
 * win on id conflict, per mergePlugins). */
export function listSkills(): LlmSkillDescription[] {
	return mergePlugins("llm:skill", builtinSkills).filter(
		(s: any): s is LlmSkillDescription =>
			!!s && typeof s.id === "string" && typeof s.description === "string"
	)
}

/** The skills active for a run: datatype-matched against the focused doc,
 * enabled by id on the chat, or forced by the caller. Loads each active
 * skill's module (cached); skills that fail to load are skipped. */
export async function resolveActiveSkills(opts: {
	focusedType?: string | null
	enabledIds: Set<string>
	forcedIds?: string[]
}): Promise<ActiveSkill[]> {
	const out: ActiveSkill[] = []
	for (const desc of listSkills()) {
		const byType =
			!!opts.focusedType &&
			Array.isArray(desc.datatypes) &&
			desc.datatypes.includes(opts.focusedType)
		const byId = opts.enabledIds.has(desc.id)
		const forced = opts.forcedIds?.includes(desc.id) ?? false
		if (!byType && !byId && !forced) continue
		const module = await loadSkillModule(desc)
		if (!module) continue
		out.push({
			id: desc.id,
			name: desc.name || desc.id,
			description: desc.description,
			module,
		})
	}
	return out
}

// Loaded modules by skill id. A failed load is NOT cached, so a bundle that
// registers late (or a transient import failure) gets retried next run.
const moduleCache = new Map<string, LlmSkillModule>()

/** Load one skill by id and return it as an ActiveSkill, or null when the id
 * is unknown or its module fails to load. For MID-RUN activation — the
 * load_skill tool and read_doc datatype auto-activation — where the caller
 * appends the result to its active set and feeds the instructions back to
 * the model as tool output (the already-sent system prompt is not rebuilt). */
export async function activateSkill(id: string): Promise<ActiveSkill | null> {
	const desc = listSkills().find((s) => s.id === id)
	if (!desc) return null
	const module = await loadSkillModule(desc)
	if (!module) return null
	return {
		id: desc.id,
		name: desc.name || desc.id,
		description: desc.description,
		module,
	}
}

/** Ids of skills whose module has been loaded (for the debug panel). */
export function loadedSkillIds(): Set<string> {
	return new Set(moduleCache.keys())
}

/** The cached module for a skill, if it has been loaded (for the debug
 * panel — does NOT trigger a load). */
export function peekSkillModule(id: string): LlmSkillModule | undefined {
	return moduleCache.get(id)
}

async function loadSkillModule(
	desc: LlmSkillDescription
): Promise<LlmSkillModule | null> {
	const cached = moduleCache.get(desc.id)
	if (cached) return cached
	try {
		// Built-ins expose load() inline; registry entries lose their load()
		// crossing the registration boundary, so they load via reg.load(id)
		// (which caches the result under `.module`).
		const module =
			typeof desc.load === "function"
				? await desc.load()
				: (await loadPlugin("llm:skill", desc.id))?.module
		if (!module || typeof module.instructions !== "string") {
			console.warn("[llm-skills] skill has no instructions:", desc.id)
			return null
		}
		moduleCache.set(desc.id, module)
		return module
	} catch (e) {
		console.warn("[llm-skills] failed to load skill:", desc.id, e)
		return null
	}
}

/** The "## Skills" system-prompt section: full instructions for active skills,
 * plus a one-line index of the inactive ones (so the model knows what exists
 * and can tell the user how to activate it). Empty string when there is
 * nothing to say. */
export function skillsPromptSection(
	active: ActiveSkill[],
	all: LlmSkillDescription[]
): string {
	const activeIds = new Set(active.map((s) => s.id))
	const inactive = all.filter((s) => !activeIds.has(s.id))
	if (active.length === 0 && inactive.length === 0) return ""
	const parts: string[] = ["## Skills"]
	if (active.length > 0) {
		parts.push(
			"Instruction packs active for this turn. Follow each skill's instructions when working in its domain."
		)
		for (const s of active) {
			parts.push(`### Skill: ${s.name}\n${s.module.instructions.trim()}`)
		}
	}
	if (inactive.length > 0) {
		parts.push(
			"Installed but NOT active. A skill auto-activates when you read_doc a document matching its datatypes. To work on a matching document you have NOT read (or before creating one), activate the skill YOURSELF first with the load_skill tool — do not guess a skill's document schema, and do not ask the user to activate it for you:\n" +
				inactive
					.map((s) => `- ${s.id}: ${s.description}`)
					.join("\n")
		)
	}
	return parts.join("\n\n")
}

/** The tool schemas contributed by the active skills, deduped against the
 * given already-taken names (built-ins and custom tools win). */
export function skillToolSchemas(
	active: ActiveSkill[],
	takenNames: Set<string>
): LlmSkillTool[] {
	const out: LlmSkillTool[] = []
	for (const s of active) {
		for (const t of s.module.tools ?? []) {
			if (!t?.name || takenNames.has(t.name)) continue
			takenNames.add(t.name)
			out.push({
				name: t.name,
				description: t.description || `(${s.name} skill tool)`,
				parameters:
					t.parameters && typeof t.parameters === "object"
						? t.parameters
						: {type: "object", properties: {}},
			})
		}
	}
	return out
}

/** Dispatch a tool call to the active skill that owns it. Returns null when no
 * active skill declares the tool (callers then fall through to other
 * dispatchers), else the stringified result. */
export async function runSkillTool(
	active: ActiveSkill[],
	name: string,
	args: any,
	ctx: LlmSkillToolCtx
): Promise<string | null> {
	for (const s of active) {
		if (!(s.module.tools ?? []).some((t) => t?.name === name)) continue
		if (typeof s.module.runTool !== "function") continue
		try {
			const result = await s.module.runTool(name, args, ctx)
			if (result === undefined) return "(tool ran; no return value)"
			return typeof result === "string"
				? result
				: JSON.stringify(result, null, 2)
		} catch (e: any) {
			return `skill tool error (${s.id}): ` + (e?.message || String(e))
		}
	}
	return null
}

// ── Built-in skills ──────────────────────────────────────────────────────────
// Reference implementations, and the registry fallback (the same pattern as
// featurePlugins/slashPlugins). The momputer persona used to be an inline
// system-prompt addendum in ChatRoot; it is forced active when the user
// addresses @momputer, and can also be enabled chat-wide via /plugin.

const MOMPUTER_INSTRUCTIONS = `Be warm, nurturing, and motherly in your responses. Use gentle encouragement, express care and concern, and be supportive like a loving mom would be. You can use pet names like "sweetie", "honey", "dear", etc. Still be helpful and knowledgeable, but with a cozy maternal energy.`

export const builtinSkills: LlmSkillDescription[] = [
	{
		type: "llm:skill",
		id: "momputer",
		name: "Momputer",
		description:
			"A warm, nurturing, motherly persona. Applies automatically when the user addresses @momputer.",
		async load() {
			return {instructions: MOMPUTER_INSTRUCTIONS}
		},
	},
]
