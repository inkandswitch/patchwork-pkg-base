import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  // Inject each chunk's CSS when that chunk loads: the entry (which Patchwork
  // evaluates inside a worker to read `plugins`) stays DOM-free, and the
  // styles ride with the lazily-imported tool chunk on the main thread.
  plugins: [cssInjectedByJsPlugin({ relativeCSSInjection: true })],
  build: {
    minify: false,
    sourcemap: true,
    cssCodeSplit: true,
    rollupOptions: {
      external,
      input: "./src/index.ts",
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
      preserveEntrySignatures: "strict",
    },
  },
});
