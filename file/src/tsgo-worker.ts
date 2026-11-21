// TypeScript 7's language server (tsgo, compiled to wasm) in a worker, talking
// json-rpc with the editors' LSP client. Its files are in memory: the open
// editors' documents (as the client sends them), any an embedding tool gives
// it (tsgo/files.ts), and one tsconfig for them all. The page's first message
// says where tsgo.wasm is; the rest are LSP, or those files.
import {startTsgo, type Tsgo} from "./tsgo/host"
import {changeFile, type FileChange} from "./tsgo/files"
import {TSCONFIG} from "./tsgo/tsconfig"

type Message = {lsp: string} | {wasm: string} | FileChange

let tsgo: Tsgo | undefined
const queue: Exclude<Message, {wasm: string}>[] = []

function handle(ready: Tsgo, message: Exclude<Message, {wasm: string}>) {
	if ("lsp" in message) ready.send(message.lsp)
	else changeFile(ready, message)
}

function start(wasm: string) {
	startTsgo(fetch(wasm), (lsp) => self.postMessage({lsp}))
		.then((ready) => {
			tsgo = ready
			ready.fs.writeFile("/tsconfig.json", TSCONFIG)
			for (const message of queue.splice(0)) handle(ready, message)
		})
		.catch((error) => {
			console.error("[tsgo] failed to start", error)
			self.postMessage({failed: String(error?.message ?? error)})
		})
}

self.onmessage = (event: MessageEvent<Message>) => {
	if ("wasm" in event.data) return start(event.data.wasm)
	if (tsgo) handle(tsgo, event.data)
	else queue.push(event.data)
}
