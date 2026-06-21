import {render} from "solid-js/web"
import html from "solid-js/html"
import {createSignal, createEffect} from "solid-js"
import {getType} from "@inkandswitch/patchwork-filesystem"
import {getRegistry} from "@inkandswitch/patchwork-plugins"

function DocOpenWith(handle, element) {
	const [tools, setTools] = createSignal([])
	const [currentToolId, setCurrentToolId] = createSignal(null)
	const [open, setOpen] = createSignal(false)

	function refresh() {
		const doc = handle.doc()
		if (!doc) return setTools([])
		const type = getType(doc)
		if (!type) return setTools([])
		const list = getRegistry("patchwork:tool").filter(t => {
			const sd = t.supportedDatatypes
			const matches =
				sd === "*" ||
				(Array.isArray(sd) && (sd.includes(type) || sd.includes("*")))
			return matches && !t.unlisted && !t.forTitleBar
		})
		list.sort((a, b) => {
			const aWild =
				a.supportedDatatypes === "*" ||
				(Array.isArray(a.supportedDatatypes) &&
					a.supportedDatatypes.includes("*"))
			const bWild =
				b.supportedDatatypes === "*" ||
				(Array.isArray(b.supportedDatatypes) &&
					b.supportedDatatypes.includes("*"))
			return aWild - bWild
		})
		setTools(list)
	}

	refresh()
	handle.on("change", refresh)
	const off = getRegistry("patchwork:tool").on("changed", refresh)

	const doc = handle.doc()
	if (doc) {
		const datatypeId = getType(doc)
		if (datatypeId) {
			getRegistry("patchwork:datatype")
				.load(datatypeId)
				.then(() => refresh())
		}
	}

	createEffect(() => {
		const list = tools()
		if (list.length && !currentToolId()) setCurrentToolId(list[0].id)
	})

	function onOpenDoc(e) {
		if (e.detail?.url === handle.url && e.detail?.toolId) {
			const ids = new Set(tools().map(t => t.id))
			if (ids.has(e.detail.toolId)) setCurrentToolId(e.detail.toolId)
		}
	}
	window.addEventListener("patchwork:open-document", onOpenDoc, true)

	function pickTool(toolId) {
		setCurrentToolId(toolId)
		menuEl.hidePopover()
		element.dispatchEvent(
			new CustomEvent("patchwork:open-document", {
				detail: {url: handle.url, toolId},
				bubbles: true,
				composed: true,
			}),
		)
	}

	const currentName = () => {
		const t = tools().find(t => t.id === currentToolId())
		return t?.name || ""
	}

	const chevron = `<svg width="8" height="5" viewBox="0 0 8 5" fill="none" style="display:block"><path d="M1 1l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

	const style = document.createElement("style")
	style.textContent = `
		.doc-openwith {
			display: flex;
			align-items: center;
			height: 100%;
		}
		.doc-openwith-btn {
			display: flex;
			align-items: center;
			gap: 4px;
			height: 22px;
			padding: 0 6px 0 8px;
			border: 1px solid var(--color-base-300, #d0d0d0);
			border-radius: 3px;
			background: var(--color-base-100, #fff);
			color: var(--color-base-content, #333);
			font: inherit;
			font-size: 0.8em;
			font-weight: 500;
			cursor: pointer;
			transition: border-color 0.12s, background 0.12s;
			white-space: nowrap;
			user-select: none;
		}
		.doc-openwith-btn:hover {
			border-color: var(--color-base-400, #aaa);
			background: var(--color-base-200, #f4f4f4);
		}
		.doc-openwith-btn--open {
			border-color: var(--color-base-400, #aaa);
			background: var(--color-base-200, #f4f4f4);
		}
		.doc-openwith-btn .doc-openwith-chevron {
			opacity: 0.5;
			transition: transform 0.15s;
		}
		.doc-openwith-btn--open .doc-openwith-chevron {
			transform: rotate(180deg);
		}
		.doc-openwith-menu[popover] {
			position: fixed;
			inset: unset;
			margin: 0;
			padding: 0;
			border: 1px solid var(--color-base-300, #d0d0d0);
			border-radius: 4px;
			background: var(--color-base-100, #fff);
			box-shadow: 0 2px 8px rgba(0,0,0,0.08);
			overflow: hidden;
		}
		.doc-openwith-input {
			display: block;
			width: 100%;
			padding: 5px 8px;
			border: none;
			border-bottom: 1px solid var(--color-base-200, #eee);
			background: none;
			font: inherit;
			font-size: 0.8em;
			color: inherit;
			outline: none;
			box-sizing: border-box;
		}
		.doc-openwith-list {
			max-height: 200px;
			overflow-y: auto;
			padding: 3px;
		}
		.doc-openwith-item {
			display: block;
			width: 100%;
			padding: 4px 8px;
			border: none;
			border-radius: 2px;
			background: none;
			color: inherit;
			font: inherit;
			font-size: 0.8em;
			text-align: left;
			cursor: pointer;
			white-space: nowrap;
		}
		.doc-openwith-item:hover,
		.doc-openwith-item--highlight {
			background: var(--color-base-200, #f0f0f0);
		}
		.doc-openwith-item--active {
			font-weight: 600;
		}
	`
	element.appendChild(style)

	// Popover menu with search input
	const menuEl = document.createElement("div")
	menuEl.popover = "auto"
	menuEl.className = "doc-openwith-menu"
	element.appendChild(menuEl)

	menuEl.addEventListener("toggle", e => setOpen(e.newState === "open"))

	function buildMenu() {
		menuEl.replaceChildren()

		const input = document.createElement("input")
		input.className = "doc-openwith-input"
		input.placeholder = "Search or enter tool id\u2026"
		menuEl.appendChild(input)

		const list = document.createElement("div")
		list.className = "doc-openwith-list"
		menuEl.appendChild(list)

		let highlighted = 0
		let filtered = []

		function highlightAt(i) {
			highlighted = i
			for (const [j, el] of [...list.children].entries()) {
				el.classList.toggle("doc-openwith-item--highlight", j === i)
			}
		}

		function renderList() {
			const q = input.value.toLowerCase()
			filtered = tools().filter(
				t =>
					!q ||
					t.name.toLowerCase().includes(q) ||
					t.id.toLowerCase().includes(q),
			)
			list.replaceChildren()
			filtered.forEach((t, i) => {
				const item = document.createElement("button")
				item.className = "doc-openwith-item"
				if (t.id === currentToolId())
					item.classList.add("doc-openwith-item--active")
				if (i === highlighted)
					item.classList.add("doc-openwith-item--highlight")
				item.textContent = t.name
				item.addEventListener("click", () => pickTool(t.id))
				item.addEventListener("pointerenter", () => highlightAt(i))
				list.appendChild(item)
			})
		}

		input.addEventListener("input", () => {
			highlighted = 0
			renderList()
		})

		input.addEventListener("keydown", e => {
			if (e.key === "ArrowDown") {
				e.preventDefault()
				highlightAt(Math.min(highlighted + 1, filtered.length - 1))
				list.children[highlighted]?.scrollIntoView({block: "nearest"})
			} else if (e.key === "ArrowUp") {
				e.preventDefault()
				highlightAt(Math.max(highlighted - 1, 0))
				list.children[highlighted]?.scrollIntoView({block: "nearest"})
			} else if (e.key === "Enter") {
				e.preventDefault()
				const q = input.value.trim()
				if (highlighted >= 0 && highlighted < filtered.length) {
					pickTool(filtered[highlighted].id)
				} else if (q) {
					pickTool(q)
				}
			} else if (e.key === "Escape") {
				menuEl.hidePopover()
			}
		})

		renderList()
		queueMicrotask(() => input.focus())
	}

	function toggleMenu() {
		const btn = element.querySelector(".doc-openwith-btn")
		if (!btn) return
		if (!open()) buildMenu()
		const rect = btn.getBoundingClientRect()
		const menuWidth = Math.max(rect.width, 180)
		menuEl.style.top = rect.bottom + 2 + "px"
		menuEl.style.minWidth = menuWidth + "px"
		// align left unless it would overflow the viewport, then align right
		if (rect.left + menuWidth > window.innerWidth - 8) {
			menuEl.style.left = ""
			menuEl.style.right = window.innerWidth - rect.right + "px"
		} else {
			menuEl.style.right = ""
			menuEl.style.left = rect.left + "px"
		}
		menuEl.togglePopover()
	}

	const dispose = render(
		() =>
			html`<div class="doc-openwith">
				${() => {
					if (!tools().length) return null
					return html`<button
						class=${() => `doc-openwith-btn${open() ? " doc-openwith-btn--open" : ""}`}
						onClick=${toggleMenu}
					>
						${() => currentName()}
						<span
							class="doc-openwith-chevron"
							innerHTML=${chevron}
						></span>
					</button>`
				}}
			</div>`,
		element,
	)

	return () => {
		handle.off("change", refresh)
		off()
		window.removeEventListener("patchwork:open-document", onOpenDoc, true)
		menuEl.remove()
		style.remove()
		dispose()
	}
}

export const plugins = [
	{
		type: "patchwork:tool",
		id: "doc-openwith",
		tags: ["titlebar-tool"],
		name: "Open With",
		icon: "ArrowRightLeft",
		supportedDatatypes: "*",
		forTitleBar: true,
		unlisted: true,
		async load() {
			return DocOpenWith
		},
	},
]
