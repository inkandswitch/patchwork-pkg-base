import {defineConfig} from "vite"
import solidPlugin from "vite-plugin-solid"
import external from "@inkandswitch/patchwork-bootloader/externals"

export default defineConfig({
	plugins: [solidPlugin()],
	// the TypeScript language server's worker loads its wasm runtime with a
	// dynamic import, which needs a module worker
	worker: {format: "es"},
	build: {
		sourcemap: true,
		lib: {
			entry: "src/index.ts",
			formats: ["es"],
			fileName: "index",
		},
		rollupOptions: {external},
	},
})
