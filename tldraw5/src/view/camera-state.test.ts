import {afterEach, describe, expect, it, vi} from "vitest"
import {accept} from "@inkandswitch/patchwork-providers"
import type {Editor} from "@tldraw/tldraw"
import {shareCamera} from "./camera-state"

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => {
	for (let i = 0; i < 8; i++) await tick()
}
const frame = () => new Promise(resolve => requestAnimationFrame(resolve))

function fakeHandle() {
	const doc: Record<string, unknown> = {}
	const listeners = new Set<() => void>()
	return {
		doc: () => doc,
		change(fn: (doc: Record<string, unknown>) => void) {
			fn(doc)
			listeners.forEach(l => l())
		},
		on: (_: "change", fn: () => void) => listeners.add(fn),
		off: (_: "change", fn: () => void) => listeners.delete(fn),
		replace(next: Record<string, unknown>) {
			for (const key of Object.keys(doc)) delete doc[key]
			Object.assign(doc, next)
			listeners.forEach(l => l())
		},
	}
}

// as much of an editor as following needs
function fakeEditor() {
	let page = "page:1"
	let bounds = {x: 0, y: 0, w: 800, h: 600}
	const listeners = new Set<() => void>()
	const moved = () => listeners.forEach(l => l())
	return {
		getViewportPageBounds: () => bounds,
		getCurrentPageId: () => page,
		getPage: (id: string) => (id.startsWith("page:") ? {id} : undefined),
		setCurrentPage: vi.fn((id: string) => {
			page = id
			moved()
		}),
		zoomToBounds: vi.fn((box: typeof bounds) => {
			bounds = box
			moved()
		}),
		store: {
			listen: (fn: () => void) => {
				listeners.add(fn)
				return () => listeners.delete(fn)
			},
		},
		// the person looking moving about
		pan(to: typeof bounds) {
			bounds = to
			moved()
		},
	}
}

let host: HTMLElement
function setup() {
	host = document.createElement("div")
	const view = host.appendChild(document.createElement("div"))
	document.body.append(host)
	host.addEventListener("patchwork:subscribe", event => {
		const selector = (event as CustomEvent).detail?.selector
		if (selector?.type === "patchwork:view-state") {
			accept(event as CustomEvent, respond => respond("automerge:view"))
		}
	})
	const handle = fakeHandle()
	const editor = fakeEditor()
	const stop = shareCamera(view, {find: async () => handle}, editor as unknown as Editor)
	return {handle, editor, stop}
}

afterEach(() => host?.remove())

describe("shareCamera", () => {
	it("says where it's looking, from the start and as it moves", async () => {
		const {handle, editor, stop} = setup()
		await settle()
		expect(handle.doc()).toEqual({tldraw: {page: "page:1", bounds: {x: 0, y: 0, w: 800, h: 600}}})
		editor.pan({x: 100.123, y: 50, w: 800, h: 600})
		await frame()
		expect(handle.doc()).toEqual({tldraw: {page: "page:1", bounds: {x: 100.12, y: 50, w: 800, h: 600}}})
		stop()
	})

	it("theirs heard, it goes there: their page, and the part of it they see", async () => {
		const {handle, editor, stop} = setup()
		await settle()
		handle.replace({tldraw: {page: "page:2", bounds: {x: 10, y: 20, w: 400, h: 300}}})
		expect(editor.setCurrentPage).toHaveBeenCalledWith("page:2")
		expect(editor.zoomToBounds).toHaveBeenCalledWith(
			{x: 10, y: 20, w: 400, h: 300},
			expect.objectContaining({immediate: true, force: true}),
		)
		// and isn't written back over theirs as it catches up
		await frame()
		expect(handle.doc()).toEqual({tldraw: {page: "page:2", bounds: {x: 10, y: 20, w: 400, h: 300}}})
		stop()
	})

	it("what isn't a camera is nothing", async () => {
		const {handle, editor, stop} = setup()
		await settle()
		handle.replace({tldraw: {page: "page:2", bounds: {x: 0, y: 0, w: 0, h: 0}}})
		handle.replace({text: {top: 4}})
		expect(editor.zoomToBounds).not.toHaveBeenCalled()
		stop()
	})
})
