import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import externals from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  plugins: [cssInjectedByJsPlugin({ relativeCSSInjection: true })],

  build: {
    sourcemap: true,
    cssCodeSplit: true,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      external: externals,
      input: "./src/index.js",
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
