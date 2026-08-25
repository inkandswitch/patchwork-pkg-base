// A small fold-out debug panel listing every known llm:skill and its state:
// whether it was active for the most recent computer run, whether its module
// has been loaded, and what would activate it (datatype match or /plugin).
// The list is re-read each time the panel is opened, so late-registering
// bundles show up without a reload.

import {createSignal, For, Show} from "solid-js"
import {
	listSkills,
	loadedSkillIds,
	peekSkillModule,
	type ActiveSkill,
	type LlmSkillDescription,
} from "../lib/llm-skills"

// Bump when shipping a change you want to verify made it to a running client
// (pushwork-synced tools can lag; this shows which build is actually loaded).
const CHAT_VERSION = "v0.0.2"

export function SkillsDebug(props: {
	/** Skills active for the most recent computer run. */
	active: () => ActiveSkill[]
	/** Skill ids enabled on this chat via /plugin load. */
	enabledIds: () => Set<string>
}) {
	const [open, setOpen] = createSignal(false)

	return (
		<details
			class="chat-skills-debug"
			onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
			<summary>
				debug: skills
				<span class="chat-skills-debug-version">{CHAT_VERSION}</span>
				<Show when={props.active().length > 0}>
					<span class="chat-skills-debug-count">
						{props.active().length} active
					</span>
				</Show>
			</summary>
			{/* Remounted on every open so listSkills()/loadedSkillIds() are fresh. */}
			<Show when={open()}>
				<SkillRows active={props.active} enabledIds={props.enabledIds} />
			</Show>
		</details>
	)
}

function SkillRows(props: {
	active: () => ActiveSkill[]
	enabledIds: () => Set<string>
}) {
	const skills = listSkills()
	const loaded = loadedSkillIds()
	const isActive = (id: string) => props.active().some((s) => s.id === id)

	return (
		<div class="chat-skills-debug-list">
			<Show when={skills.length === 0}>
				<div class="chat-skills-debug-empty">no skills registered</div>
			</Show>
			<For each={skills}>
				{(skill) => (
					<div class="chat-skills-debug-row">
						<span
							class="chat-skills-debug-state"
							data-state={
								isActive(skill.id)
									? "active"
									: loaded.has(skill.id)
										? "loaded"
										: "idle"
							}>
							{isActive(skill.id)
								? "active"
								: loaded.has(skill.id)
									? "loaded"
									: "idle"}
						</span>
						<span class="chat-skills-debug-id">{skill.id}</span>
						<span class="chat-skills-debug-meta">{skillMeta(skill, props.enabledIds())}</span>
						<div class="chat-skills-debug-desc">{skill.description}</div>
					</div>
				)}
			</For>
			<div class="chat-skills-debug-note">
				active = in the last computer run's prompt · loaded = module cached ·
				a skill activates when the focused doc matches its datatypes, when
				the model reads a matching doc or calls load_skill, or via /plugin
				load &lt;id&gt;
			</div>
		</div>
	)
}

// The activation summary for one row: how the skill turns on, plus the tools
// its loaded module contributes.
function skillMeta(
	skill: LlmSkillDescription,
	enabledIds: Set<string>
): string {
	const parts: string[] = []
	if (skill.datatypes?.length) parts.push(`on: ${skill.datatypes.join(", ")}`)
	if (enabledIds.has(skill.id)) parts.push("enabled via /plugin")
	const tools = peekSkillModule(skill.id)?.tools
	if (tools?.length) parts.push(`tools: ${tools.map((t) => t.name).join(", ")}`)
	return parts.join(" · ")
}
