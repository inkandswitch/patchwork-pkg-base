import {afterEach, describe, expect, it, vi} from "vitest"
import {createMemFS} from "./memfs"
import {handleMessage} from "./messages"

// a tsgo whose filesystem throws on one path
function fakeTsgo() {
	const fs = createMemFS()
	const writeFile = fs.writeFile.bind(fs)
	fs.writeFile = (path: string, text: string) => {
		if (path.includes("broken")) throw new Error("no room")
		return writeFile(path, text)
	}
	const sent: string[] = []
	return {
		fs,
		notify: () => {},
		refresh: () => {},
		send: (message: string) => sent.push(message),
		sent,
	}
}

describe("a message for tsgo", () => {
	afterEach(() => vi.restoreAllMocks())

	it("is passed on after a file change that threw, which is said so", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {})
		const tsgo = fakeTsgo()
		const queued = [
			{writeFile: {path: "/broken/index.js", text: ""}},
			{lsp: '{"method":"initialize"}'},
			{writeFile: {path: "/fine/index.js", text: "export {}"}},
		]
		for (const message of queued) expect(() => handleMessage(tsgo, message)).not.toThrow()
		expect(tsgo.sent).toEqual(['{"method":"initialize"}'])
		expect(tsgo.fs.readFile("/fine/index.js")).toBe("export {}")
		expect(error).toHaveBeenCalledTimes(1)
	})
})
