import {afterEach, describe, expect, it} from "vitest"
import {accept} from "@inkandswitch/patchwork-providers"
import {viewStateOf, type ViewState} from "./view-state"

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => {
	for (let i = 0; i < 8; i++) await tick()
}

// a doc as the view's repo would hand it over
function fakeHandle(doc: Record<string, unknown> = {}) {
	const listeners = new Set<() => void>()
	return {
		doc: () => doc,
		change(fn: (doc: Record<string, unknown>) => void) {
			fn(doc)
			listeners.forEach(l => l())
		},
		on: (_: "change", fn: () => void) => listeners.add(fn),
		off: (_: "change", fn: () => void) => listeners.delete(fn),
		// someone else's change: theirs, followed
		replace(next: Record<string, unknown>) {
			for (const key of Object.keys(doc)) delete doc[key]
			Object.assign(doc, next)
			listeners.forEach(l => l())
		},
	}
}

let host: HTMLElement
function setup(handle = fakeHandle()) {
	host = document.createElement("div")
	const view = host.appendChild(document.createElement("div"))
	document.body.append(host)
	host.addEventListener("patchwork:subscribe", event => {
		const selector = (event as CustomEvent).detail?.selector
		if (selector?.type === "patchwork:view-state") {
			accept(event as CustomEvent, respond => respond("automerge:view"))
		}
	})
	const repo = {find: async () => handle}
	return {view, repo, handle}
}

afterEach(() => host?.remove())

describe("viewStateOf", () => {
	it("writes what's set, once it's found, and hears what it didn't write", async () => {
		const {view, repo, handle} = setup()
		const heard: ViewState[] = []
		const link = viewStateOf(view, repo, state => heard.push(state))
		link.set({text: {top: 5}})
		await settle()
		expect(handle.doc()).toEqual({text: {top: 5}})
		// its own writes aren't heard back
		link.set({text: {top: 9}})
		expect(heard).toEqual([{}])
		handle.replace({text: {top: 40}})
		expect(heard.at(-1)).toEqual({text: {top: 40}})
		link.stop()
	})

	it("doesn't write over what's there already when it's found (someone followed)", async () => {
		const {view, repo, handle} = setup(fakeHandle({text: {top: 70}}))
		const heard: ViewState[] = []
		const link = viewStateOf(view, repo, state => heard.push(state))
		link.set({text: {top: 0}})
		await settle()
		expect(handle.doc()).toEqual({text: {top: 70}})
		expect(heard).toEqual([{text: {top: 70}}])
		link.stop()
	})

	it("with nothing answering, it's nothing", async () => {
		const view = document.createElement("div")
		const link = viewStateOf(view, {find: async () => fakeHandle()}, () => {
			throw new Error("not heard")
		})
		link.set({text: {top: 1}})
		await settle()
		link.stop()
	})
})
